import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SessionStore } from "../../src/agy/session-store.ts";
import { createE2EEnv, destroyE2EEnv } from "./helpers.ts";

describe("e2e/session-store", () => {
  it("persists conversation binding across store instances", async () => {
    const env = await createE2EEnv();
    try {
      const a = new SessionStore(env.stateFile, env.bindingLockFile);
      await a.set("s1", "conv-1", "prev");
      const b = new SessionStore(env.stateFile, env.bindingLockFile);
      const entry = await b.getEntry("s1");
      assert.deepEqual(entry, { conversationId: "conv-1", prevOutput: "prev" });
    } finally {
      await destroyE2EEnv(env);
    }
  });

  it("serializes concurrent writes", async () => {
    const env = await createE2EEnv();
    try {
      const store = new SessionStore(env.stateFile, env.bindingLockFile);
      await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          store.set(`s-${i}`, `c-${i}`, `out-${i}`),
        ),
      );
      for (let i = 0; i < 20; i++) {
        const entry = await store.getEntry(`s-${i}`);
        assert.equal(entry?.conversationId, `c-${i}`);
        assert.equal(entry?.prevOutput, `out-${i}`);
      }
    } finally {
      await destroyE2EEnv(env);
    }
  });

  it("binding lock is exclusive", async () => {
    const env = await createE2EEnv();
    try {
      const store = new SessionStore(env.stateFile, env.bindingLockFile);
      const release = await store.acquireBindingLock({ timeoutMs: 2_000 });
      let secondAcquired = false;
      const waiter = store
        .acquireBindingLock({ timeoutMs: 200 })
        .then(async (r) => {
          secondAcquired = true;
          await r();
        })
        .catch((err: Error) => err);

      await new Promise((r) => setTimeout(r, 50));
      assert.equal(secondAcquired, false);
      await release();
      const result = await waiter;
      // either timed out or acquired after release
      if (result instanceof Error) {
        assert.equal(result.name, "TimeoutError");
      } else {
        assert.equal(secondAcquired, true);
      }
    } finally {
      await destroyE2EEnv(env);
    }
  });
});
