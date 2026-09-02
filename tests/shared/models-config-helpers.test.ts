import { describe, expect, it } from "vitest";
import {
  isPlainObject,
  asStringArray,
  parseModelEntry,
  parseAgentSection,
  readModelsConfigFile,
} from "../../src/shared/models-config.ts";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("models-config helpers", () => {
  it("isPlainObject", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject("x")).toBe(false);
    expect(isPlainObject(123)).toBe(false);
  });
  it("asStringArray", () => {
    expect(asStringArray("x")).toBeUndefined();
    expect(asStringArray([])).toBeUndefined();
    expect(asStringArray(["  ", ""])).toBeUndefined();
    expect(asStringArray(["a", " ", "b"])).toEqual(["a", "b"]);
    expect(asStringArray(["a"])).toEqual(["a"]);
  });
  it("parseModelEntry", () => {
    expect(parseModelEntry(null, "id")).toBeNull();
    expect(parseModelEntry({}, "id")?.name).toBe("id");
    expect(parseModelEntry({ name: "  " }, "id")?.name).toBe("id");
    expect(parseModelEntry({ name: "N", variants: ["", "high"] }, "id")?.variants).toEqual([
      "high",
    ]);
    expect(parseModelEntry({ defaultVariant: "  " }, "id")?.defaultVariant).toBeUndefined();
    expect(parseModelEntry({ defaultVariant: "x" }, "id")?.defaultVariant).toBe("x");
    expect(parseModelEntry({ contextWindow: 0 }, "id")?.contextWindow).toBeUndefined();
    expect(parseModelEntry({ contextWindow: 100.5 }, "id")?.contextWindow).toBe(100);
    expect(parseModelEntry({ maxTokens: -1 }, "id")?.maxTokens).toBeUndefined();
    expect(parseModelEntry({ maxTokens: 200.9 }, "id")?.maxTokens).toBe(200);
  });
  it("parseAgentSection", () => {
    expect(parseAgentSection(null)).toBeUndefined();
    expect(parseAgentSection({})).toBeUndefined();
    expect(parseAgentSection({ models: "bad" })).toEqual({});
    expect(parseAgentSection({ models: { "  ": {}, good: {} } })).toEqual({
      good: expect.any(Object),
    });
    expect(parseAgentSection({ models: { bad: null } })).toEqual({});
  });
  it("readModelsConfigFile ENOENT and invalid", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rcf-"));
    const missing = join(dir, "missing.jsonc");
    const r = await readModelsConfigFile(missing);
    expect(r.exists).toBe(false);
    const badPath = join(dir, "bad.jsonc");
    await writeFile(badPath, "{ bad", "utf-8");
    await expect(readModelsConfigFile(badPath)).rejects.toThrow(/Invalid JSONC/);
    const dirPath = join(dir, "adir");
    await mkdir(dirPath);
    await expect(readModelsConfigFile(dirPath)).rejects.toBeDefined();
    // test non-ENOENT via injected mock
    await expect(
      readModelsConfigFile(join(dir, "any.jsonc"), async () => {
        throw Object.assign(new Error("e"), { code: "EACCES" });
      }),
    ).rejects.toThrow();
    // test error without code (covers false branch of code extraction)
    await expect(
      readModelsConfigFile(join(dir, "any2.jsonc"), async () => {
        throw new Error("no code");
      }),
    ).rejects.toThrow();
    await expect(
      readModelsConfigFile(join(dir, "any3.jsonc"), async () => {
        throw "string error" as any;
      }),
    ).rejects.toThrow();
    await rm(dir, { recursive: true, force: true });
  });
});
