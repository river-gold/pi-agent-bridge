import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { discoverModels, HARDCODED_AGY_MODELS, toPiModels } from "../../src/agy/agy-models.ts";

describe("e2e/models", () => {
  it("discoverModels returns hardcoded gemini-3.7-flash", async () => {
    const result = await discoverModels({
      binary: "/nonexistent/agy",
      cacheFile: "/tmp/unused-agy-models-cache.json",
      force: true,
    });
    assert.equal(result.models.length, 1);
    assert.equal(result.models[0]?.id, "gemini-3.7-flash");
    assert.deepEqual(result.meta.get("gemini-3.7-flash")?.variants, [
      "high",
      "medium",
      "low",
    ]);
  });

  it("hardcoded catalog is stable", () => {
    assert.ok(HARDCODED_AGY_MODELS["gemini-3.7-flash"]);
    const { models } = toPiModels();
    assert.deepEqual(
      models.map((m) => m.id),
      ["gemini-3.7-flash"],
    );
  });
});
