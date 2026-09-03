import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore, tryAcquireLock } from "../../src/shared/session-store.ts";

describe("SessionStore 동시성 및 락 경합", () => {
  it("tryAcquireLock creates and releases", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ss-"));
    const lock = join(dir, "test.lock");
    const release = await tryAcquireLock(lock);
    expect(release).toBeTruthy();
    if (release) await release();
    // second acquire should succeed after release
    const release2 = await tryAcquireLock(lock);
    expect(release2).toBeTruthy();
    if (release2) await release2();
    await rm(dir, { recursive: true, force: true });
  });

  it("tryAcquireLock returns null when second create fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ss-"));
    const lock = join(dir, "test.lock");
    await writeFile(lock, JSON.stringify({ token: "other", pid: 99999 }), "utf-8");
    // isAlive returns false -> stale lock stolen, then second create succeeds, so not null
    // isAlive true -> not stale, second fails -> null
    const release = await tryAcquireLock(lock, { isAlive: () => true, staleTimeoutMs: 100000 });
    expect(release).toBeNull();
    await rm(dir, { recursive: true, force: true });
  });

  it("tryAcquireLock steals stale lock", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ss-"));
    const lock = join(dir, "test.lock");
    await writeFile(lock, JSON.stringify({ token: "old", pid: 99999 }), "utf-8");
    const release = await tryAcquireLock(lock, { isAlive: () => false });
    expect(release).toBeTruthy();
    if (release) await release();
    await rm(dir, { recursive: true, force: true });
  });

  it("parseLock and errCode branches", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ss-"));
    const lock = join(dir, "test.lock");
    // invalid JSON -> parseLock null, should steal via mtime
    await writeFile(lock, "not json", "utf-8");
    // wait for stale
    await new Promise((r) => setTimeout(r, 10));
    const release = await tryAcquireLock(lock, { staleTimeoutMs: 1 });
    expect(release).toBeTruthy();
    if (release) await release();
    await rm(dir, { recursive: true, force: true });
  });

  it("SessionStore set and getEntry", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ss-"));
    const state = join(dir, "state.json");
    const binding = join(dir, "binding.lock");
    const store = new SessionStore(state, binding);
    await store.set("sess1", "conv1", "prev");
    const entry = await store.getEntry("sess1");
    expect(entry).toEqual({ conversationId: "conv1", prevOutput: "prev" });
    expect(await store.getEntry("missing")).toBeNull();
    await rm(dir, { recursive: true, force: true });
  });

  it("SessionStore handles invalid store format", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ss-"));
    const state = join(dir, "state.json");
    const binding = join(dir, "binding.lock");
    await mkdir(dir, { recursive: true });
    await writeFile(state, JSON.stringify({ sessions: "not an object" }), "utf-8");
    const store = new SessionStore(state, binding);
    await expect(store.getEntry("x")).rejects.toThrow("Invalid session store");
    await rm(dir, { recursive: true, force: true });
  });

  it("acquireBindingLock with abort", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ss-"));
    const state = join(dir, "state.json");
    const binding = join(dir, "binding.lock");
    const store = new SessionStore(state, binding);
    // hold lock
    const release = await store.acquireBindingLock();
    const controller = new AbortController();
    controller.abort();
    await expect(
      store.acquireBindingLock({ abortSignal: controller.signal, timeoutMs: 100 }),
    ).rejects.toThrow();
    await release();
    await rm(dir, { recursive: true, force: true });
  });

  it("acquireBindingLock timeout", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ss-"));
    const state = join(dir, "state.json");
    const binding = join(dir, "binding.lock");
    const store = new SessionStore(state, binding);
    const release = await store.acquireBindingLock();
    await expect(store.acquireBindingLock({ timeoutMs: 50 })).rejects.toThrow("Timed out");
    await release();
    await rm(dir, { recursive: true, force: true });
  });
});
