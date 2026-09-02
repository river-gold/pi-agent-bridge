import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, rm, mkdir, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SessionStore,
  tryAcquireLock,
  acquireLock,
  createLockFile,
  maybeStealStaleLock,
  releaseLock,
  isStale,
  abortError,
  timeoutError,
  throwIfCancelled,
  sleep,
  getAbortReason,
  errCode,
  defaultIsAlive,
  parseLock,
} from "../../src/shared/session-store.ts";

describe("session-store comprehensive", () => {
  it("basic lock and store", async () => {
    const dir = await mkdtemp(join(tmpdir(), "comp-"));
    const sf = join(dir, "s.json");
    const lf = join(dir, "b.lock");
    const store = new SessionStore(sf, lf);
    expect(await store.getEntry("none")).toBeNull();
    await store.set("s1", "conv1", "prev");
    expect(await store.getEntry("s1")).toEqual({ conversationId: "conv1", prevOutput: "prev" });
    const lock = await tryAcquireLock(join(dir, "a.lock"));
    expect(lock).not.toBeNull();
    await lock!();
    await rm(dir, { recursive: true, force: true });
  });

  it("isStale", () => {
    expect(isStale(Date.now() - 100000, 1000)).toBe(true);
    expect(isStale(Date.now(), 100000)).toBe(false);
  });

  it("createLockFile exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "comp2-"));
    const p = join(dir, "a.lock");
    await writeFile(p, "x");
    expect(await createLockFile(p, "t")).toBe("exists");
    await rm(dir, { recursive: true, force: true });
  });

  it("helpers and error branches", () => {
    expect(parseLock("bad json")).toBeNull();
    expect(parseLock(JSON.stringify({ token: "t", pid: 1 }))).toEqual({ token: "t", pid: 1 });
    expect(parseLock(JSON.stringify({ token: "t", pid: "not-a-number" }))).toBeNull();
    expect(parseLock(JSON.stringify({ token: 123, pid: 1 }))).toBeNull();
    expect(parseLock(JSON.stringify(123))).toBeNull();
    expect(errCode({ code: "EEXIST" })).toBe("EEXIST");
    expect(errCode({ code: 123 })).toBeUndefined();
    expect(errCode("non-object")).toBeUndefined();
    expect(errCode(null)).toBeUndefined();
    expect(getAbortReason(new Error("a"))).toBe("a");
    expect(getAbortReason("str")).toBe("str");
    expect(getAbortReason(undefined)).toBe("The operation was aborted");
    const ctrl = new AbortController();
    ctrl.abort(new Error("a"));
    expect(abortError(ctrl.signal).name).toBe("AbortError");
    const ctrl2 = new AbortController();
    ctrl2.abort("str");
    expect(abortError(ctrl2.signal).message).toBe("str");
    expect(timeoutError().name).toBe("TimeoutError");
    expect(defaultIsAlive(process.pid)).toBe(true);
  });

  it("defaultIsAlive EPERM and ESRCH handling", () => {
    const origKill = process.kill;
    try {
      process.kill = (() => {
        const err = new Error("EPERM") as NodeJS.ErrnoException;
        err.code = "EPERM";
        throw err;
      }) as typeof process.kill;
      expect(defaultIsAlive(12345)).toBe(true);

      process.kill = (() => {
        const err = new Error("ESRCH") as NodeJS.ErrnoException;
        err.code = "ESRCH";
        throw err;
      }) as typeof process.kill;
      expect(defaultIsAlive(12345)).toBe(false);
    } finally {
      process.kill = origKill;
    }
  });

  it("throwIfCancelled and sleep cancellation", async () => {
    expect(() => throwIfCancelled(undefined, undefined)).not.toThrow();
    expect(() => throwIfCancelled(undefined, Date.now() - 100)).toThrow("Timed out acquiring lock");
    const ac = new AbortController();
    ac.abort();
    expect(() => throwIfCancelled(ac.signal, undefined)).toThrow(/was aborted/i);

    await sleep(1, undefined, undefined);
    await sleep(5, undefined, Date.now() + 50);
    await expect(sleep(100, undefined, Date.now() - 10)).rejects.toThrow(
      "Timed out acquiring lock",
    );

    const abortedAc = new AbortController();
    abortedAc.abort();
    await expect(sleep(100, abortedAc.signal, undefined)).rejects.toThrow(/was aborted/i);

    const inflightAc = new AbortController();
    setTimeout(() => inflightAc.abort(), 10);
    await expect(sleep(500, inflightAc.signal, undefined)).rejects.toThrow(/was aborted/i);
  });

  it("createLockFile error branches and fh cleanup", async () => {
    const dir = await mkdtemp(join(tmpdir(), "comp3-"));
    await expect(
      createLockFile(join(dir, "bad.lock"), "tok", (async () => {
        throw new Error("open failure");
      }) as any),
    ).rejects.toThrow("open failure");

    const mockFh = {
      writeFile: async () => {
        throw new Error("write fail");
      },
      stat: async () => ({ dev: 1, ino: 1 }),
      close: async () => {
        throw new Error("close fail");
      },
    };
    await expect(
      createLockFile(join(dir, "bad2.lock"), "tok", (async () => mockFh) as any),
    ).rejects.toThrow("write fail");

    const mockFh2 = {
      writeFile: async () => {},
      stat: async () => ({ dev: 1, ino: 1 }),
      close: async () => {
        throw new Error("close fail");
      },
    };
    const res = await createLockFile(join(dir, "good.lock"), "tok", (async () => mockFh2) as any);
    expect(res).toEqual({ token: "tok", dev: 1, ino: 1 });
    await rm(dir, { recursive: true, force: true });
  });

  it("maybeStealStaleLock and releaseLock edge cases", async () => {
    const dir = await mkdtemp(join(tmpdir(), "comp4-"));
    await maybeStealStaleLock(join(dir, "nonexistent.lock"), 1000, () => false);

    const nonStalePath = join(dir, "nonstale.lock");
    await writeFile(nonStalePath, "invalid json");
    await maybeStealStaleLock(nonStalePath, 1000000, () => false);
    const nonStaleStat = await stat(nonStalePath);
    expect(nonStaleStat.isFile()).toBe(true);

    const lockPath = join(dir, "rel.lock");
    const rel = await tryAcquireLock(lockPath);
    expect(rel).not.toBeNull();

    const relDevMismatch = releaseLock(lockPath, { token: "mismatch", dev: 999999, ino: 999999 });
    await relDevMismatch();

    const pathStat = await stat(lockPath);
    const relTokenMismatch = releaseLock(lockPath, {
      token: "wrong-token",
      dev: pathStat.dev,
      ino: pathStat.ino,
    });
    await relTokenMismatch();

    await rel!();
    await relTokenMismatch();
    await rm(dir, { recursive: true, force: true });
  });

  it("acquireLock timeout and post-acquire cancellation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "comp5-"));
    await expect(acquireLock(join(dir, "fail.lock"), {}, 1, async () => null)).rejects.toThrow(
      "Timed out acquiring lock",
    );

    let released = false;
    const acLock = new AbortController();
    const fakeAcquire = async () => {
      acLock.abort();
      return async () => {
        released = true;
      };
    };
    await expect(
      acquireLock(join(dir, "abort.lock"), { abortSignal: acLock.signal }, 5, fakeAcquire),
    ).rejects.toThrow(/was aborted/i);
    expect(released).toBe(true);

    const store = new SessionStore(dir, join(dir, "b.lock"));
    await expect(store.getEntry("x")).rejects.toThrow();
    await rm(dir, { recursive: true, force: true });
  });
});
