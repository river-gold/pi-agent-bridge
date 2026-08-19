import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildThinkingLevelMap,
  parseAgyModels,
  resolveAgyModelId,
  toPiModels,
} from "../src/agy-models.ts";

const sample = `Fetching available models...
gemini-3.7-flash-high	Gemini 3.7 Flash (High)
gemini-3.7-flash-medium	Gemini 3.7 Flash (Medium)
gemini-3.7-flash-low	Gemini 3.7 Flash (Low)
gemini-3.1-pro-high	Gemini 3.1 Pro (High)
gemini-3.1-pro-low	Gemini 3.1 Pro (Low)
claude-sonnet-4-6	Claude Sonnet 4.6 (Thinking)
gpt-oss-120b-medium	GPT-OSS 120B (Medium)
`;

describe("parseAgyModels", () => {
  it("groups suffix siblings under base id", () => {
    const models = parseAgyModels(sample);
    assert.deepEqual(models["gemini-3.7-flash"], {
      name: "Gemini 3.7 Flash",
      defaultVariant: "high",
      variants: ["high", "medium", "low"],
    });
    assert.equal(models["gemini-3.7-flash-high"], undefined);
  });

  it("keeps lone ids", () => {
    const models = parseAgyModels(sample);
    assert.deepEqual(models["claude-sonnet-4-6"], {
      name: "Claude Sonnet 4.6 (Thinking)",
    });
    assert.deepEqual(models["gpt-oss-120b-medium"], {
      name: "GPT-OSS 120B (Medium)",
    });
  });

  it("groups two-variant models", () => {
    const models = parseAgyModels(sample);
    assert.deepEqual(models["gemini-3.1-pro"], {
      name: "Gemini 3.1 Pro",
      defaultVariant: "high",
      variants: ["high", "low"],
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
  it("marks variant models as reasoning", () => {
    const { models, meta } = toPiModels(parseAgyModels(sample));
    const flash = models.find((m) => m.id === "gemini-3.7-flash");
    assert.ok(flash);
    assert.equal(flash.reasoning, true);
    assert.ok(flash.thinkingLevelMap);
    assert.equal(meta.get("gemini-3.7-flash")?.defaultVariant, "high");

    const claude = models.find((m) => m.id === "claude-sonnet-4-6");
    assert.ok(claude);
    assert.equal(claude.reasoning, false);
  });
});

describe("buildThinkingLevelMap", () => {
  it("maps levels onto available variants", () => {
    const map = buildThinkingLevelMap(["high", "low"]);
    assert.equal(map.low, "low");
    assert.equal(map.high, "high");
    assert.equal(map.medium, "high");
  });
});
