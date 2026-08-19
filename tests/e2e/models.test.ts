import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { discoverModels, parseAgyModels } from "../../src/agy/agy-models.ts";
import {
  createE2EEnv,
  destroyE2EEnv,
  writeMockAgy,
} from "./helpers.ts";

describe("e2e/models", () => {
  it("discovers and caches models from agy models", async () => {
    const env = await createE2EEnv();
    try {
      await writeMockAgy(
        env,
        `
if (args[0] === "models") {
  console.log("Fetching available models...");
  console.log("gemini-3.7-flash-high\\tGemini 3.7 Flash (High)");
  console.log("gemini-3.7-flash-medium\\tGemini 3.7 Flash (Medium)");
  console.log("gemini-3.7-flash-low\\tGemini 3.7 Flash (Low)");
  console.log("claude-sonnet-4-6\\tClaude Sonnet 4.6 (Thinking)");
  process.exit(0);
}
process.exit(1);
`,
      );

      const first = await discoverModels({
        binary: env.mockBinary,
        cacheFile: env.modelCacheFile,
        force: true,
      });

      assert.ok(first.models.some((m) => m.id === "gemini-3.7-flash"));
      assert.ok(first.models.some((m) => m.id === "claude-sonnet-4-6"));
      const flash = first.models.find((m) => m.id === "gemini-3.7-flash")!;
      assert.equal(flash.reasoning, true);
      assert.equal(flash.thinkingLevelMap?.low, "low");
      assert.equal(flash.thinkingLevelMap?.xhigh, null);
      assert.equal(first.meta.get("gemini-3.7-flash")?.defaultVariant, "high");

      const cacheRaw = await readFile(env.modelCacheFile, "utf-8");
      const cache = JSON.parse(cacheRaw) as { models: Record<string, unknown> };
      assert.ok(cache.models["gemini-3.7-flash"]);

      // stale-safe: force=false hits cache without needing models subcommand success path change
      const second = await discoverModels({
        binary: env.mockBinary,
        cacheFile: env.modelCacheFile,
        now: Date.now(),
      });
      assert.equal(second.models.length, first.models.length);
    } finally {
      await destroyE2EEnv(env);
    }
  });

  it("force refresh replaces cache", async () => {
    const env = await createE2EEnv();
    try {
      await writeMockAgy(
        env,
        `
if (args[0] === "models") {
  const { readFileSync, existsSync } = await import("node:fs");
  const phaseFile = ${JSON.stringify(env.root + "/phase")};
  const p = existsSync(phaseFile) ? readFileSync(phaseFile, "utf-8").trim() : "1";
  if (p === "1") {
    console.log("model-a\\tModel A");
  } else {
    console.log("model-b\\tModel B");
  }
  process.exit(0);
}
process.exit(1);
`,
      );

      const a = await discoverModels({
        binary: env.mockBinary,
        cacheFile: env.modelCacheFile,
        force: true,
      });
      assert.ok(a.models.some((m) => m.id === "model-a"));
      assert.ok(!a.models.some((m) => m.id === "model-b"));

      const { writeFile } = await import("node:fs/promises");
      await writeFile(env.root + "/phase", "2", "utf-8");

      const b = await discoverModels({
        binary: env.mockBinary,
        cacheFile: env.modelCacheFile,
        force: true,
      });
      assert.ok(b.models.some((m) => m.id === "model-b"));
      assert.ok(!b.models.some((m) => m.id === "model-a"));
    } finally {
      await destroyE2EEnv(env);
    }
  });

  it("returns empty when models command fails and no cache", async () => {
    const env = await createE2EEnv();
    try {
      await writeMockAgy(
        env,
        `
if (args[0] === "models") process.exit(1);
process.exit(1);
`,
      );
      const result = await discoverModels({
        binary: env.mockBinary,
        cacheFile: env.modelCacheFile,
        force: true,
      });
      assert.equal(result.models.length, 0);
    } finally {
      await destroyE2EEnv(env);
    }
  });

  it("parseAgyModels matches live agy layout sample", () => {
    const sample = `Fetching available models...
gemini-3.7-flash-high\tGemini 3.7 Flash (High)
gemini-3.7-flash-medium\tGemini 3.7 Flash (Medium)
gemini-3.7-flash-low\tGemini 3.7 Flash (Low)
gemini-3.1-pro-high\tGemini 3.1 Pro (High)
gemini-3.1-pro-low\tGemini 3.1 Pro (Low)
claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)
gpt-oss-120b-medium\tGPT-OSS 120B (Medium)
`;
    const models = parseAgyModels(sample);
    assert.deepEqual(models["gemini-3.7-flash"]?.variants, ["high", "medium", "low"]);
    assert.deepEqual(models["gemini-3.1-pro"]?.variants, ["high", "low"]);
    assert.equal(models["claude-sonnet-4-6"]?.name, "Claude Sonnet 4.6 (Thinking)");
    assert.equal(models["gpt-oss-120b-medium"]?.name, "GPT-OSS 120B (Medium)");
  });
});
