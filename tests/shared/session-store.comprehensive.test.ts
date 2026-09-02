import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as fs from "node:fs/promises";
import { SessionStore, tryAcquireLock, createLockFile, maybeStealStaleLock, isStale } from "../../src/shared/session-store.ts";

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
});
