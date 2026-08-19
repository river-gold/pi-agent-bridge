import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildThinkingLevelMap,
  discoverModels,
  HARDCODED_AGY_MODELS,
  resolveAgyModelId,
  toPiModels,
} from "../src/agy/agy-models.ts";

describe("hardcoded catalog", () => {
  it("exposes gemini-3.7-flash with high/medium/low", () => {
    assert.deepEqual(HARDCODED_AGY_MODELS["gemini-3.7-flash"], {
      name: "Gemini 3.7 Flash",
      defaultVariant: "high",
      variants: ["high", "medium", "low"],
    });
  });
});

describe("resolveAgyModelId", () => {
  it("appends thinking-level variant", () => {
    const meta = {
      defaultVariant: "high",
      variants: ["high", "medium", "low"],
    };
    assert.deepEqual(resolveAgyModelId("gemini-3.7-flash", "low", meta), {
      model: "gemini-3.7-flash-low",
    });
    assert.deepEqual(resolveAgyModelId("gemini-3.7-flash", "medium", meta), {
      model: "gemini-3.7-flash-medium",
    });
    assert.deepEqual(resolveAgyModelId("gemini-3.7-flash", undefined, meta), {
      model: "gemini-3.7-flash-high",
    });
  });

  it("passes through models without variants", () => {
    assert.deepEqual(
      resolveAgyModelId("claude-sonnet-4-6", "high", { variants: [] }),
      { model: "claude-sonnet-4-6" },
    );
  });
});

describe("toPiModels", () => {
  it("marks variant models as reasoning with low/medium/high only", () => {
    const { models, meta } = toPiModels();
    assert.equal(models.length, 1);
    const flash = models[0]!;
    assert.equal(flash.id, "gemini-3.7-flash");
    assert.equal(flash.reasoning, true);
    assert.equal(flash.thinkingLevelMap?.low, "low");
    assert.equal(flash.thinkingLevelMap?.medium, "medium");
    assert.equal(flash.thinkingLevelMap?.high, "high");
    assert.equal(flash.thinkingLevelMap?.xhigh, null);
    assert.equal(flash.thinkingLevelMap?.max, null);
    assert.equal(meta.get("gemini-3.7-flash")?.defaultVariant, "high");
  });
});

describe("discoverModels", () => {
  it("returns hardcoded catalog without calling agy", async () => {
    const result = await discoverModels();
    assert.equal(result.models.length, 1);
    assert.equal(result.models[0]?.id, "gemini-3.7-flash");
  });
});

describe("buildThinkingLevelMap", () => {
  it("maps only suffixes that match pi level names", () => {
    const map = buildThinkingLevelMap(["high", "low"]);
    assert.equal(map.off, null);
    assert.equal(map.minimal, null);
    assert.equal(map.low, "low");
    assert.equal(map.medium, null);
    assert.equal(map.high, "high");
    assert.equal(map.xhigh, null);
    assert.equal(map.max, null);
  });

  it("exposes low/medium/high when all three exist", () => {
    const map = buildThinkingLevelMap(["high", "medium", "low"]);
    assert.equal(map.low, "low");
    assert.equal(map.medium, "medium");
    assert.equal(map.high, "high");
    assert.equal(map.xhigh, null);
    assert.equal(map.max, null);
  });
});
