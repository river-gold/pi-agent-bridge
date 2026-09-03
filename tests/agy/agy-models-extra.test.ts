import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildThinkingLevelMap,
  discoverModels,
  loadAgyCatalog,
  resolveAgyModelId,
  toPiModels,
} from "../../src/agy/agy-models.ts";

describe("agy-models extra", () => {
  it("toPiModels sorting and defaults", () => {
    const { models } = toPiModels({
      z: {
        modelId: "z-model",
        name: "Z",
        variants: ["high", "low"],
        defaultVariant: "low",
        contextWindow: 1000,
        maxTokens: 500,
      },
      a: { modelId: "a-model", name: "A" },
    });
    expect(models[0].id).toBe("a");
    expect(models[1].id).toBe("z");
    expect(models[1].reasoning).toBe(true);
    expect(models[0].reasoning).toBe(false);
    expect(models[0].contextWindow).toBe(200000);
  });
  it("buildThinkingLevelMap case insensitive", () => {
    const m = buildThinkingLevelMap(["HIGH", "Low"]);
    expect(m.high).toBe("high");
    expect(m.low).toBe("low");
  });
  it("resolveAgyModelId edge empty variant", () => {
    expect(
      resolveAgyModelId("m", "high", { modelId: "m", variants: ["", ""], defaultVariant: "" }),
    ).toEqual({
      model: "m",
    });
    expect(
      resolveAgyModelId("m", undefined, {
        modelId: "m",
        variants: ["high", "low"],
        defaultVariant: "high",
      }),
    ).toEqual({ model: "m-high" });
    expect(
      resolveAgyModelId("m", "off", {
        modelId: "m",
        variants: ["high", "low"],
        defaultVariant: "high",
      }),
    ).toEqual({ model: "m-high" });
    expect(
      resolveAgyModelId("m", "unknown", {
        modelId: "m",
        variants: ["high", "low"],
        defaultVariant: "high",
      }),
    ).toEqual({ model: "m-high" });
  });
  it("loadAgyCatalog prefers antigravity", async () => {
    const dir = await mkdtemp(join(tmpdir(), "am-"));
    const fp = join(dir, "c.jsonc");
    await writeFile(
      fp,
      JSON.stringify({
        antigravity: { models: { ag1: { modelId: "ag1-model", name: "AG1" } } },
        agy: { models: { agy1: { modelId: "agy1-model", name: "Agy1" } } },
      }),
    );
    try {
      const cat = await loadAgyCatalog(fp);
      expect(Object.keys(cat)).toEqual(["ag1"]);
      const disc = await discoverModels({ configPath: fp });
      expect(disc.models[0].id).toBe("ag1");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("loadAgyCatalog fallback to agy", async () => {
    const dir = await mkdtemp(join(tmpdir(), "am2-"));
    const fp = join(dir, "c.jsonc");
    await writeFile(
      fp,
      JSON.stringify({ agy: { models: { agy1: { modelId: "agy1-model", name: "Agy1" } } } }),
    );
    try {
      const cat = await loadAgyCatalog(fp);
      expect(Object.keys(cat)).toEqual(["agy1"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
