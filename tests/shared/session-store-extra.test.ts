import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionStore, tryAcquireLock } from "../../src/shared/session-store.ts";

describe("session-store extra", () => {
  it("tryAcquireLock success and second fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ss-"));
    const lp = join(dir, "a.lock");
    const r1 = await tryAcquireLock(lp);
    expect(r1).not.toBeNull();
    const r2 = await tryAcquireLock(lp);
    expect(r2).toBeNull();
    await r1!();
    // after release, can acquire again
    const r3 = await tryAcquireLock(lp);
    expect(r3).not.toBeNull();
    await r3!();
    await rm(dir, { recursive: true, force: true });
  });
  it("steal stale when dead pid", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ss2-"));
    const lp = join(dir, "b.lock");
    await mkdir(dir, { recursive: true });
    await writeFile(lp, JSON.stringify({ token: "t", pid: 999999 }));
    const r = await tryAcquireLock(lp, { isAlive: () => false });
    expect(r).not.toBeNull();
    await r!();
    await rm(dir, { recursive: true, force: true });
  });
  it("SessionStore get/set and invalid format", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ss3-"));
    const sf = join(dir, "sessions.json");
    const lf = join(dir, "binding.lock");
    const store = new SessionStore(sf, lf);
    expect(await store.getEntry("none")).toBeNull();
    await store.set("s1", "conv1", "prev");
    expect(await store.getEntry("s1")).toEqual({ conversationId: "conv1", prevOutput: "prev" });
    await store.set("s1", null);
    expect(await store.getEntry("s1")).toEqual({ conversationId: null, prevOutput: "" });
    // invalid format
    await writeFile(sf, JSON.stringify({ sessions: "bad" }));
    await expect(store.getEntry("s1")).rejects.toThrow(/Invalid session store/);
    await writeFile(sf, "not json");
    await expect(store.getEntry("s1")).rejects.toThrow();
    await rm(dir, { recursive: true, force: true });
  });
  it("acquireBindingLock", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ss4-"));
    const store = new SessionStore(join(dir, "s.json"), join(dir, "b.lock"));
    const rel = await store.acquireBindingLock();
    await rel();
    await rm(dir, { recursive: true, force: true });
  });
  it("acquireLock abort", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ss5-"));
    const lp = join(dir, "c.lock");
    const r1 = await tryAcquireLock(lp);
    expect(r1).not.toBeNull();
    const store = new SessionStore(join(dir, "s.json"), lp);
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(store.acquireBindingLock({ abortSignal: ctrl.signal })).rejects.toThrow();
    await r1!();
    await rm(dir, { recursive: true, force: true });
  });
  it("acquireLock timeout", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ss6-"));
    const lp = join(dir, "d.lock");
    const r1 = await tryAcquireLock(lp);
    const store = new SessionStore(join(dir, "s.json"), lp);
    await expect(store.acquireBindingLock({ timeoutMs: 5 })).rejects.toThrow(/Timed out/);
    await r1!();
    await rm(dir, { recursive: true, force: true });
  });
});
