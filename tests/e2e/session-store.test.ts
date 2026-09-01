import { describe, expect, it } from "vitest";
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
			expect(entry).toEqual({ conversationId: "conv-1", prevOutput: "prev" });
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
				expect(entry?.conversationId).toBe(`c-${i}`);
				expect(entry?.prevOutput).toBe(`out-${i}`);
			}
		} finally {
			await destroyE2EEnv(env);
		}
	}, 10000);

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
			expect(secondAcquired).toBe(false);
			await release();
			const result = await waiter;
			// either timed out or acquired after release
			if (result instanceof Error) {
				expect(result.name).toBe("TimeoutError");
			} else {
				expect(secondAcquired).toBe(true);
			}
		} finally {
			await destroyE2EEnv(env);
		}
	});
});
