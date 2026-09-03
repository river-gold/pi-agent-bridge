import { describe, expect, it } from "vitest";
import { mapConfigEntry } from "../../src/agy/agy-models.ts";

describe("mapConfigEntry", () => {
  it("fallback name to id", () => {
    expect(mapConfigEntry("my-id", { modelId: "m1" }).name).toBe("my-id");
    expect(mapConfigEntry("my-id", { modelId: "m1", name: undefined }).name).toBe("my-id");
    expect(mapConfigEntry("my-id", { modelId: "m1", name: "Real" }).name).toBe("Real");
    expect(mapConfigEntry("my-id", { modelId: "m1", name: "  " }).name).toBe("  ");
  });
  it("variants and defaultVariant fallback", () => {
    expect(mapConfigEntry("id", { modelId: "m1", variants: ["a", "b"] }).defaultVariant).toBe("a");
    expect(
      mapConfigEntry("id", { modelId: "m1", variants: ["a"], defaultVariant: "x" }).defaultVariant,
    ).toBe("x");
    expect(mapConfigEntry("id", { modelId: "m1" }).variants).toEqual([]);
  });
  it("contextWindow and maxTokens", () => {
    expect(mapConfigEntry("id", { modelId: "m1", contextWindow: 100 }).contextWindow).toBe(100);
    expect(mapConfigEntry("id", { modelId: "m1", contextWindow: 0 }).contextWindow).toBeUndefined();
    expect(mapConfigEntry("id", { modelId: "m1", maxTokens: 200 }).maxTokens).toBe(200);
    expect(mapConfigEntry("id", { modelId: "m1", maxTokens: 0 }).maxTokens).toBeUndefined();
    expect(mapConfigEntry("id", { modelId: "m1", contextWindow: 100, maxTokens: 200 })).toEqual(
      expect.objectContaining({ contextWindow: 100, maxTokens: 200 }),
    );
  });
});
