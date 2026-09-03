import { describe, expect, it } from "vitest";
import { mapConfigEntry } from "../../src/agy/agy-models.ts";

describe("mapConfigEntry", () => {
  it("fallback name to id", () => {
    expect(mapConfigEntry("my-id", {}).name).toBe("my-id");
    expect(mapConfigEntry("my-id", { name: undefined }).name).toBe("my-id");
    expect(mapConfigEntry("my-id", { name: "Real" }).name).toBe("Real");
    expect(mapConfigEntry("my-id", { name: "  " }).name).toBe("  ");
  });
  it("variants and defaultVariant fallback", () => {
    expect(mapConfigEntry("id", { variants: ["a", "b"] }).defaultVariant).toBe("a");
    expect(mapConfigEntry("id", { variants: ["a"], defaultVariant: "x" }).defaultVariant).toBe("x");
    expect(mapConfigEntry("id", {}).variants).toEqual([]);
  });
  it("contextWindow and maxTokens", () => {
    expect(mapConfigEntry("id", { contextWindow: 100 }).contextWindow).toBe(100);
    expect(mapConfigEntry("id", { contextWindow: 0 }).contextWindow).toBeUndefined();
    expect(mapConfigEntry("id", { maxTokens: 200 }).maxTokens).toBe(200);
    expect(mapConfigEntry("id", { maxTokens: 0 }).maxTokens).toBeUndefined();
    expect(mapConfigEntry("id", { contextWindow: 100, maxTokens: 200 })).toEqual(
      expect.objectContaining({ contextWindow: 100, maxTokens: 200 }),
    );
  });
});
