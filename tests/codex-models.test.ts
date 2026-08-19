import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildThinkingLevelMap,
  discoverModels,
  HARDCODED_CODEX_MODELS,
  resolveCodexConfig,
  toPiModels,
} from "../src/codex/models.ts";

describe("codex hardcoded catalog", () => {
  it("exposes sol/terra/luna with low..max efforts", () => {
    assert.deepEqual(Object.keys(HARDCODED_CODEX_MODELS).sort(), [
      "gpt-5.6-luna",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
    ]);
    for (const id of Object.keys(HARDCODED_CODEX_MODELS)) {
      assert.deepEqual(HARDCODED_CODEX_MODELS[id]!.efforts, [
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
      ]);
      assert.equal(HARDCODED_CODEX_MODELS[id]!.defaultEffort, "high");
    }
  });
});

describe("resolveCodexConfig", () => {
  const meta = {
    defaultEffort: "high",
    efforts: ["low", "medium", "high", "xhigh", "max"],
  };

  it("maps thinking levels to effort", () => {
    assert.deepEqual(resolveCodexConfig("gpt-5.6-sol", "low", meta), {
      model: "gpt-5.6-sol",
      effort: "low",
    });
    assert.deepEqual(resolveCodexConfig("gpt-5.6-terra", "xhigh", meta), {
      model: "gpt-5.6-terra",
      effort: "xhigh",
    });
    assert.deepEqual(resolveCodexConfig("gpt-5.6-luna", "max", meta), {
      model: "gpt-5.6-luna",
      effort: "max",
    });
  });

  it("defaults to high when reasoning unset/off", () => {
    assert.deepEqual(resolveCodexConfig("gpt-5.6-sol", undefined, meta), {
      model: "gpt-5.6-sol",
      effort: "high",
    });
    assert.deepEqual(resolveCodexConfig("gpt-5.6-sol", "off", meta), {
      model: "gpt-5.6-sol",
      effort: "high",
    });
  });
});

describe("toPiModels / discoverModels", () => {
  it("registers three reasoning models", async () => {
    const { models, meta } = await discoverModels();
    assert.equal(models.length, 3);
    const sol = models.find((m) => m.id === "gpt-5.6-sol");
    assert.ok(sol);
    assert.equal(sol!.reasoning, true);
    assert.equal(sol!.thinkingLevelMap?.low, "low");
    assert.equal(sol!.thinkingLevelMap?.medium, "medium");
    assert.equal(sol!.thinkingLevelMap?.high, "high");
    assert.equal(sol!.thinkingLevelMap?.xhigh, "xhigh");
    assert.equal(sol!.thinkingLevelMap?.max, "max");
    assert.equal(sol!.thinkingLevelMap?.off, null);
    assert.equal(sol!.thinkingLevelMap?.minimal, null);
    assert.equal(meta.get("gpt-5.6-sol")?.defaultEffort, "high");
    assert.equal(toPiModels().models.length, 3);
  });
});

describe("buildThinkingLevelMap", () => {
  it("maps only listed efforts", () => {
    const map = buildThinkingLevelMap(["low", "high"]);
    assert.equal(map.off, null);
    assert.equal(map.low, "low");
    assert.equal(map.medium, null);
    assert.equal(map.high, "high");
    assert.equal(map.xhigh, null);
    assert.equal(map.max, null);
  });
});
