import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverModels, toPiModels } from "../../src/agy/agy-models.ts";

describe("e2e/models", () => {
  it("discoverModels returns empty without config", async () => {
    const result = await discoverModels({
      binary: "/nonexistent/agy",
      cacheFile: "/tmp/unused-agy-models-cache.json",
      force: true,
      configPath: "/tmp/pi-agent-bridge-no-models.json",
    });
    expect(result.models.length).toBe(0);
  });

  it("discoverModels loads models from config file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-e2e-models-"));
    const path = join(dir, "models.json");
    try {
      await writeFile(
        path,
        JSON.stringify({
          agy: {
            models: {
              "gemini-3.7-flash": {
                name: "Gemini 3.7 Flash",
                defaultVariant: "high",
                variants: ["high", "medium", "low"],
              },
            },
          },
        }),
        "utf-8",
      );
      const result = await discoverModels({ configPath: path });
      expect(result.models.length).toBe(1);
      expect(result.models[0]?.id).toBe("gemini-3.7-flash");
      expect(result.meta.get("gemini-3.7-flash")?.variants).toEqual(["high", "medium", "low"]);
      const { models } = toPiModels({
        "gemini-3.7-flash": {
          name: "Gemini 3.7 Flash",
          defaultVariant: "high",
          variants: ["high", "medium", "low"],
        },
      });
      expect(models.map((m) => m.id)).toEqual(["gemini-3.7-flash"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
