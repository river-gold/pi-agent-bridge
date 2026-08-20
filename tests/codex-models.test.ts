import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildThinkingLevelMap,
  discoverModels,
  resolveCodexConfig,
  toPiModels,
} from "../src/codex/models.ts";

const SAMPLE = {
  "gpt-5.6-sol": {
    name: "GPT-5.6 Sol",
    defaultEffort: "high",
    efforts: ["low", "medium", "high", "xhigh", "max"],
  },
  "gpt-5.6-terra": {
    name: "GPT-5.6 Terra",
    defaultEffort: "high",
    efforts: ["low", "medium", "high", "xhigh", "max"],
  },
  "gpt-5.6-luna": {
    name: "GPT-5.6 Luna",
    defaultEffort: "high",
    efforts: ["low", "medium", "high", "xhigh", "max"],
  },
};

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
  it("registers sample reasoning models", () => {
    const { models, meta } = toPiModels(SAMPLE);
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
  });

  it("returns empty when config missing", async () => {
    const { models } = await discoverModels({
      configPath: "/tmp/pi-agent-bridge-no-models.json",
    });
    assert.equal(models.length, 0);
    assert.equal(toPiModels().models.length, 0);
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
