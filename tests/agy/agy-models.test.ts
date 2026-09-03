import { describe, expect, it } from "vitest";
import {
  buildThinkingLevelMap,
  discoverModels,
  resolveAgyModelId,
  toPiModels,
} from "../../src/agy/agy-models.ts";

const SAMPLE = {
  "gemini-3.7-flash": {
    modelId: "gemini-3.7-flash",
    name: "Gemini 3.7 Flash",
    defaultVariant: "high",
    variants: ["high", "medium", "low"],
  },
};

describe("resolveAgyModelId", () => {
  it("appends thinking-level variant", () => {
    const meta = {
      modelId: "gemini-3.7-flash",
      defaultVariant: "high",
      variants: ["high", "medium", "low"],
    };
    expect(resolveAgyModelId("gemini-3.7-flash", "low", meta)).toEqual({
      model: "gemini-3.7-flash-low",
    });
    expect(resolveAgyModelId("gemini-3.7-flash", "medium", meta)).toEqual({
      model: "gemini-3.7-flash-medium",
    });
    expect(resolveAgyModelId("gemini-3.7-flash", undefined, meta)).toEqual({
      model: "gemini-3.7-flash-high",
    });
  });

  it("passes through models without variants", () => {
    expect(
      resolveAgyModelId("claude-sonnet-4-6", "high", {
        modelId: "claude-sonnet-4-6",
        variants: [],
      }),
    ).toEqual({
      model: "claude-sonnet-4-6",
    });
  });
});

describe("toPiModels", () => {
  it("marks variant models as reasoning with low/medium/high only", () => {
    const { models, meta } = toPiModels(SAMPLE);
    expect(models.length).toBe(1);
    const flash = models[0];
    if (!flash) throw new Error("missing model");
    expect(flash.id).toBe("gemini-3.7-flash");
    expect(flash.reasoning).toBe(true);
    expect(flash.thinkingLevelMap?.low).toBe("low");
    expect(flash.thinkingLevelMap?.medium).toBe("medium");
    expect(flash.thinkingLevelMap?.high).toBe("high");
    expect(flash.thinkingLevelMap?.xhigh).toBe(null);
    expect(flash.thinkingLevelMap?.max).toBe(null);
    expect(meta.get("gemini-3.7-flash")?.defaultVariant).toBe("high");
  });

  it("returns empty catalog by default", () => {
    expect(toPiModels().models.length).toBe(0);
  });
});

describe("discoverModels", () => {
  it("returns empty when config missing", async () => {
    const result = await discoverModels({
      configPath: "/tmp/pi-agent-bridge-no-models.json",
    });
    expect(result.models.length).toBe(0);
  });
});

describe("buildThinkingLevelMap", () => {
  it("maps only suffixes that match pi level names", () => {
    const map = buildThinkingLevelMap(["high", "low"]);
    expect(map.off).toBe(null);
    expect(map.minimal).toBe(null);
    expect(map.low).toBe("low");
    expect(map.medium).toBe(null);
    expect(map.high).toBe("high");
    expect(map.xhigh).toBe(null);
    expect(map.max).toBe(null);
  });

  it("exposes low/medium/high when all three exist", () => {
    const map = buildThinkingLevelMap(["high", "medium", "low"]);
    expect(map.low).toBe("low");
    expect(map.medium).toBe("medium");
    expect(map.high).toBe("high");
    expect(map.xhigh).toBe(null);
    expect(map.max).toBe(null);
  });
});
