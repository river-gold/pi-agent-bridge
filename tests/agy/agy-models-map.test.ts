import { describe, expect, it } from "vitest";
import { mapConfigEntry } from "../../src/agy/agy-models.ts";

describe("mapConfigEntry", () => {
  it("fallback name to id", () => {
    expect(mapConfigEntry("my-id", {} as any).name).toBe("my-id");
    expect(mapConfigEntry("my-id", { name: undefined } as any).name).toBe("my-id");
    expect(mapConfigEntry("my-id", { name: "Real" } as any).name).toBe("Real");
    expect(mapConfigEntry("my-id", { name: "  " } as any).name).toBe("  ");
  });
  it("variants and defaultVariant fallback", () => {
    expect(mapConfigEntry("id", { variants: ["a", "b"] } as any).defaultVariant).toBe("a");
    expect(mapConfigEntry("id", { variants: ["a"], defaultVariant: "x" } as any).defaultVariant).toBe("x");
    expect(mapConfigEntry("id", {} as any).variants).toEqual([]);
  });
  it("contextWindow and maxTokens", () => {
    expect(mapConfigEntry("id", { contextWindow: 100 } as any).contextWindow).toBe(100);
    expect(mapConfigEntry("id", { contextWindow: 0 } as any).contextWindow).toBeUndefined();
    expect(mapConfigEntry("id", { maxTokens: 200 } as any).maxTokens).toBe(200);
    expect(mapConfigEntry("id", { maxTokens: 0 } as any).maxTokens).toBeUndefined();
    expect(mapConfigEntry("id", { contextWindow: 100, maxTokens: 200 } as any)).toEqual(expect.objectContaining({ contextWindow: 100, maxTokens: 200 }));
  });
});
