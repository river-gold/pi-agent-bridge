import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadModelsConfigFile,
  parseModelsConfig,
  resolveAgentCatalog,
} from "../../src/shared/models-config.ts";

describe("models-config extra", () => {
  it("parseModelsConfig non-plain", () => {
    expect(parseModelsConfig(null)).toEqual({});
    expect(parseModelsConfig([])).toEqual({});
    expect(parseModelsConfig("x")).toEqual({});
  });
  it("parseModelsConfig ignores non-object agent", () => {
    const cfg = parseModelsConfig({ agy: "bad", antigravity: null });
    expect(cfg.agy).toBeUndefined();
    expect(cfg.antigravity).toBeUndefined();
  });
  it("parseModelsConfig handles models not plain", () => {
    const cfg = parseModelsConfig({ agy: { models: "bad" } });
    expect(cfg.agy?.models).toEqual({});
  });
  it("parseModelsConfig skips empty id and null entry", () => {
    const cfg = parseModelsConfig({
      agy: { models: { "  ": { name: "x" }, bad: null, good: { name: "G" } } },
    });
    expect(Object.keys(cfg.agy!.models!)).toEqual(["good"]);
  });
  it("parseModelsConfig handles variants and numbers edge", () => {
    const cfg = parseModelsConfig({
      agy: {
        models: {
          m1: {
            name: "  ",
            variants: ["", " ", "high"],
            defaultVariant: "  ",
            contextWindow: 0,
            maxTokens: -1,
          },
        },
      },
    });
    expect(cfg.agy?.models?.m1?.name).toBe("m1");
    expect(cfg.agy?.models?.m1?.variants).toEqual(["high"]);
    expect(cfg.agy?.models?.m1?.defaultVariant).toBeUndefined();
    expect(cfg.agy?.models?.m1?.contextWindow).toBeUndefined();
  });
  it("parseModelsConfig valid numbers", () => {
    const cfg = parseModelsConfig({
      agy: { models: { m1: { name: "M", contextWindow: 100.5, maxTokens: 200.9 } } },
    });
    expect(cfg.agy?.models?.m1?.contextWindow).toBe(100);
    expect(cfg.agy?.models?.m1?.maxTokens).toBe(200);
  });
  it("resolveAgentCatalog missing", () => {
    expect(resolveAgentCatalog("agy", {}, () => ({}))).toEqual({});
    expect(resolveAgentCatalog("agy", { agy: {} }, () => ({}))).toEqual({});
  });
  it("loadModelsConfigFile EISDIR throws", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mc-"));
    const fp = join(dir, "file.jsonc");
    await mkdir(fp);
    try {
      await expect(loadModelsConfigFile(fp)).rejects.toMatchObject({ code: "EISDIR" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("loadModelsConfigFile Invalid JSONC", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mc2-"));
    const fp = join(dir, "bad.jsonc");
    await writeFile(fp, "{ bad", "utf-8");
    try {
      await expect(loadModelsConfigFile(fp)).rejects.toThrow(/Invalid JSONC/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
