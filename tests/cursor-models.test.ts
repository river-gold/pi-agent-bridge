import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  discoverModels,
  resolveCursorModel,
  toPiModels,
  withEffortParam,
} from "../src/cursor/models.ts";

describe("withEffortParam", () => {
  it("appends effort to bare model id", () => {
    assert.equal(withEffortParam("composer-2.5", "high"), "composer-2.5[effort=high]");
  });

  it("replaces empty brackets", () => {
    assert.equal(withEffortParam("default[]", "high"), "default[effort=high]");
  });

  it("merges into existing params and replaces effort", () => {
    assert.equal(
      withEffortParam("claude-x[fast=true]", "high"),
      "claude-x[fast=true,effort=high]",
    );
    assert.equal(
      withEffortParam("claude-x[effort=low,fast=true]", "high"),
      "claude-x[fast=true,effort=high]",
    );
  });
});

describe("resolveCursorModel", () => {
  it("returns base as-is without efforts", () => {
    assert.equal(
      resolveCursorModel("default[]", "high", { acpModelValue: "default[]", efforts: [] }),
      "default[]",
    );
    assert.equal(resolveCursorModel("default[]", undefined, undefined), "default[]");
  });

  it("maps thinking to model[effort=...]", () => {
    const meta = {
      acpModelValue: "composer-2.5",
      defaultEffort: "high",
      efforts: ["low", "medium", "high", "xhigh"],
    };
    assert.equal(
      resolveCursorModel("composer-2.5", "low", meta),
      "composer-2.5[effort=low]",
    );
    assert.equal(
      resolveCursorModel("composer-2.5", undefined, meta),
      "composer-2.5[effort=high]",
    );
    assert.equal(
      resolveCursorModel("composer-2.5", "max", meta),
      "composer-2.5[effort=high]",
    );
  });

  it("uses default[] base with effort", () => {
    const meta = {
      acpModelValue: "default[]",
      defaultEffort: "medium",
      efforts: ["low", "medium", "high"],
    };
    assert.equal(
      resolveCursorModel("default[]", "high", meta),
      "default[effort=high]",
    );
  });
});

describe("toPiModels / discoverModels", () => {
  it("marks models with efforts as reasoning", () => {
    const { models, meta } = toPiModels({
      "composer-2.5": {
        name: "Composer 2.5",
        acpModelValue: "composer-2.5",
        defaultEffort: "high",
        efforts: ["low", "medium", "high", "xhigh"],
      },
      "default[]": {
        name: "Auto",
        acpModelValue: "default[]",
      },
    });
    const composer = models.find((m) => m.id === "composer-2.5");
    const auto = models.find((m) => m.id === "default[]");
    assert.equal(composer?.reasoning, true);
    assert.equal(composer?.thinkingLevelMap?.high, "high");
    assert.equal(composer?.thinkingLevelMap?.max, null);
    assert.equal(auto?.reasoning, false);
    assert.equal(meta.get("composer-2.5")?.defaultEffort, "high");
  });

  it("loads efforts from config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-cursor-models-"));
    const path = join(dir, "models.json");
    try {
      await writeFile(
        path,
        JSON.stringify({
          cursor: {
            models: {
              "default[]": { name: "Auto" },
              "composer-2.5": {
                name: "Composer 2.5",
                efforts: ["low", "high"],
                defaultEffort: "high",
              },
            },
          },
        }),
        "utf-8",
      );
      const { models, meta } = await discoverModels({ configPath: path });
      assert.deepEqual(
        models.map((m) => m.id).sort(),
        ["composer-2.5", "default[]"],
      );
      assert.equal(
        resolveCursorModel("composer-2.5", "low", meta.get("composer-2.5")),
        "composer-2.5[effort=low]",
      );
      assert.equal(
        resolveCursorModel("default[]", "high", meta.get("default[]")),
        "default[]",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns empty when config missing", async () => {
    const { models } = await discoverModels({
      configPath: "/tmp/pi-agent-bridge-no-models.json",
    });
    assert.equal(models.length, 0);
  });
});
