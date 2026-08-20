import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildThinkingLevelMap,
  discoverModels,
  resolveGrokConfig,
  toPiModels,
} from "../src/grok/models.ts";

const SAMPLE = {
  "grok-4.6": {
    name: "Grok 4.6",
    defaultEffort: "high",
    efforts: ["low", "medium", "high", "xhigh"],
  },
};

describe("resolveGrokConfig", () => {
  const meta = {
    defaultEffort: "high",
    efforts: ["low", "medium", "high", "xhigh"],
  };

  it("maps thinking levels to effort", () => {
    assert.deepEqual(resolveGrokConfig("grok-4.6", "low", meta), {
      model: "grok-4.6",
      effort: "low",
    });
    assert.deepEqual(resolveGrokConfig("grok-4.6", "xhigh", meta), {
      model: "grok-4.6",
      effort: "xhigh",
    });
  });

  it("defaults to high when reasoning unset/off", () => {
    assert.deepEqual(resolveGrokConfig("grok-4.6", undefined, meta), {
      model: "grok-4.6",
      effort: "high",
    });
    assert.deepEqual(resolveGrokConfig("grok-4.6", "off", meta), {
      model: "grok-4.6",
      effort: "high",
    });
  });

  it("does not map max (unsupported)", () => {
    assert.deepEqual(resolveGrokConfig("grok-4.6", "max", meta), {
      model: "grok-4.6",
      effort: "high",
    });
  });
});

describe("toPiModels / discoverModels", () => {
  it("registers sample model without max", () => {
    const { models, meta } = toPiModels(SAMPLE);
    assert.equal(models.length, 1);
    const g = models.find((m) => m.id === "grok-4.6");
    assert.ok(g);
    assert.equal(g!.reasoning, true);
    assert.equal(g!.thinkingLevelMap?.low, "low");
    assert.equal(g!.thinkingLevelMap?.medium, "medium");
    assert.equal(g!.thinkingLevelMap?.high, "high");
    assert.equal(g!.thinkingLevelMap?.xhigh, "xhigh");
    assert.equal(g!.thinkingLevelMap?.max, null);
    assert.equal(g!.thinkingLevelMap?.off, null);
    assert.equal(meta.get("grok-4.6")?.defaultEffort, "high");
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
