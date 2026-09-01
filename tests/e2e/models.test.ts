import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { discoverModels, toPiModels } from "../../src/agy/agy-models.ts";

describe("e2e/models", () => {
	it("discoverModels returns empty without config", async () => {
		const result = await discoverModels({
			binary: "/nonexistent/agy",
			cacheFile: "/tmp/unused-agy-models-cache.json",
			force: true,
			configPath: "/tmp/pi-agent-bridge-no-models.json",
		});
		assert.equal(result.models.length, 0);
	});

	it("discoverModels loads models from config file", async () => {
		const dir = await mkdtemp(join(tmpdir(), "pi-e2e-models-"));
		const path = join(dir, "models.json");
		try {
			await writeFile(
				path,
				JSON.stringify({
					agy: {
						models: {
							"gemini-3.7-flash": {
								name: "Gemini 3.7 Flash",
								defaultVariant: "high",
								variants: ["high", "medium", "low"],
							},
						},
					},
				}),
				"utf-8",
			);
			const result = await discoverModels({ configPath: path });
			assert.equal(result.models.length, 1);
			assert.equal(result.models[0]?.id, "gemini-3.7-flash");
			assert.deepEqual(result.meta.get("gemini-3.7-flash")?.variants, [
				"high",
				"medium",
				"low",
			]);
			const { models } = toPiModels({
				"gemini-3.7-flash": {
					name: "Gemini 3.7 Flash",
					defaultVariant: "high",
					variants: ["high", "medium", "low"],
				},
			});
			assert.deepEqual(
				models.map((m) => m.id),
				["gemini-3.7-flash"],
			);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
