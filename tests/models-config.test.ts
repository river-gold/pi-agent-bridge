import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { discoverModels as discoverAgy } from "../src/agy/agy-models.ts";
import { discoverModels as discoverCodex } from "../src/codex/models.ts";
import { discoverModels as discoverCursor } from "../src/cursor/models.ts";
import { discoverModels as discoverGrok } from "../src/grok/models.ts";
import {
  defaultModelsConfigPath,
  loadModelsConfigFile,
  parseModelsConfig,
  resolveAgentCatalog,
  resolveModelsConfigPath,
} from "../src/shared/models-config.ts";

describe("models-config", () => {
  it("resolveModelsConfigPath prefers override then env then package root", () => {
    const prev = process.env.PI_AGENT_BRIDGE_CONFIG;
    try {
      delete process.env.PI_AGENT_BRIDGE_CONFIG;
      assert.equal(resolveModelsConfigPath(), defaultModelsConfigPath());
      assert.match(defaultModelsConfigPath(), /models\.jsonc$/);
      assert.ok(defaultModelsConfigPath().includes("pi-agent-bridge"));
      assert.equal(resolveModelsConfigPath("/tmp/x.json"), "/tmp/x.json");
      process.env.PI_AGENT_BRIDGE_CONFIG = "/tmp/env.json";
      assert.equal(resolveModelsConfigPath(), "/tmp/env.json");
      assert.equal(resolveModelsConfigPath("/tmp/override.json"), "/tmp/override.json");
    } finally {
      if (prev === undefined) delete process.env.PI_AGENT_BRIDGE_CONFIG;
      else process.env.PI_AGENT_BRIDGE_CONFIG = prev;
    }
  });

  it("parseModelsConfig accepts agent model sections", () => {
    const cfg = parseModelsConfig({
      agy: {
        models: {
          m1: { name: "M1", variants: ["high", "low"], defaultVariant: "high" },
        },
      },
      cursor: {
        models: {
          "default[]": { name: "Auto" },
        },
      },
      ignored: { models: { x: {} } },
    });
    assert.deepEqual(Object.keys(cfg.agy?.models ?? {}), ["m1"]);
    assert.equal(cfg.agy?.models?.m1?.defaultVariant, "high");
    assert.equal(cfg.cursor?.models?.["default[]"]?.name, "Auto");
    assert.equal(cfg.codex, undefined);
  });

  it("resolveAgentCatalog returns empty when section missing", () => {
    const out = resolveAgentCatalog("codex", {}, (id, e) => ({
      name: e.name ?? id,
    }));
    assert.deepEqual(out, {});
  });

  it("resolveAgentCatalog maps section models", () => {
    const out = resolveAgentCatalog(
      "codex",
      { codex: { models: { b: { name: "B" } } } },
      (id, e) => ({ name: e.name ?? id }),
    );
    assert.deepEqual(out, { b: { name: "B" } });
  });

  it("loadModelsConfigFile + discoverModels honor config file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-models-cfg-"));
    const path = join(dir, "models.json");
    try {
      await writeFile(
        path,
        JSON.stringify({
          agy: {
            models: {
              "custom-agy": {
                name: "Custom Agy",
                variants: ["high"],
                defaultVariant: "high",
              },
            },
          },
          codex: {
            models: {
              "only-sol": {
                name: "Only Sol",
                efforts: ["low", "high"],
                defaultEffort: "low",
              },
            },
          },
          grok: {
            models: {
              "grok-x": {
                name: "Grok X",
                efforts: ["medium"],
                defaultEffort: "medium",
              },
            },
          },
          cursor: {
            models: {
              composer: {
                name: "Composer",
                acpModelValue: "composer-2.5[fast=true]",
              },
            },
          },
        }),
        "utf-8",
      );

      const loaded = await loadModelsConfigFile(path);
      assert.equal(loaded.exists, true);

      const agy = await discoverAgy({ configPath: path });
      assert.deepEqual(
        agy.models.map((m) => m.id),
        ["custom-agy"],
      );

      const codex = await discoverCodex({ configPath: path });
      assert.deepEqual(
        codex.models.map((m) => m.id),
        ["only-sol"],
      );
      assert.equal(codex.meta.get("only-sol")?.defaultEffort, "low");

      const grok = await discoverGrok({ configPath: path });
      assert.deepEqual(
        grok.models.map((m) => m.id),
        ["grok-x"],
      );

      const cursor = await discoverCursor({ configPath: path });
      assert.deepEqual(
        cursor.models.map((m) => m.id),
        ["composer"],
      );
      assert.equal(cursor.meta.get("composer")?.acpModelValue, "composer-2.5[fast=true]");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("missing config file yields empty catalogs", async () => {
    const missing = join(tmpdir(), "pi-models-missing-" + Date.now() + ".json");
    const agy = await discoverAgy({ configPath: missing });
    assert.equal(agy.models.length, 0);
    const cursor = await discoverCursor({ configPath: missing });
    assert.equal(cursor.models.length, 0);
  });
});
