import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  discoverModels,
  HARDCODED_CURSOR_MODELS,
  resolveCursorModel,
  toPiModels,
} from "../src/cursor/models.ts";

describe("cursor hardcoded catalog", () => {
  it("exposes only auto → default[]", () => {
    assert.deepEqual(Object.keys(HARDCODED_CURSOR_MODELS), ["auto"]);
    assert.equal(HARDCODED_CURSOR_MODELS.auto?.acpModelValue, "default[]");
  });
});

describe("resolveCursorModel", () => {
  it("maps auto to default[]", () => {
    assert.equal(resolveCursorModel("auto", { acpModelValue: "default[]" }), "default[]");
    assert.equal(resolveCursorModel("auto", undefined), "default[]");
  });
});

describe("toPiModels / discoverModels", () => {
  it("registers single non-reasoning auto model", async () => {
    const { models, meta } = await discoverModels();
    assert.equal(models.length, 1);
    assert.equal(models[0]?.id, "auto");
    assert.equal(models[0]?.reasoning, false);
    assert.equal(meta.get("auto")?.acpModelValue, "default[]");
    assert.equal(toPiModels().models.length, 1);
  });
});
