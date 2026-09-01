import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	buildThinkingLevelMap,
	discoverModels,
	resolveAgyModelId,
	toPiModels,
} from "../src/agy/agy-models.ts";

const SAMPLE = {
	"gemini-3.7-flash": {
		name: "Gemini 3.7 Flash",
		defaultVariant: "high",
		variants: ["high", "medium", "low"],
	},
};

describe("resolveAgyModelId", () => {
	it("appends thinking-level variant", () => {
		const meta = {
			defaultVariant: "high",
			variants: ["high", "medium", "low"],
		};
		assert.deepEqual(resolveAgyModelId("gemini-3.7-flash", "low", meta), {
			model: "gemini-3.7-flash-low",
		});
		assert.deepEqual(resolveAgyModelId("gemini-3.7-flash", "medium", meta), {
			model: "gemini-3.7-flash-medium",
		});
		assert.deepEqual(resolveAgyModelId("gemini-3.7-flash", undefined, meta), {
			model: "gemini-3.7-flash-high",
		});
	});

	it("passes through models without variants", () => {
		assert.deepEqual(
			resolveAgyModelId("claude-sonnet-4-6", "high", { variants: [] }),
			{ model: "claude-sonnet-4-6" },
		);
	});
});

describe("toPiModels", () => {
	it("marks variant models as reasoning with low/medium/high only", () => {
		const { models, meta } = toPiModels(SAMPLE);
		assert.equal(models.length, 1);
		const flash = models[0]!;
		assert.equal(flash.id, "gemini-3.7-flash");
		assert.equal(flash.reasoning, true);
		assert.equal(flash.thinkingLevelMap?.low, "low");
		assert.equal(flash.thinkingLevelMap?.medium, "medium");
		assert.equal(flash.thinkingLevelMap?.high, "high");
		assert.equal(flash.thinkingLevelMap?.xhigh, null);
		assert.equal(flash.thinkingLevelMap?.max, null);
		assert.equal(meta.get("gemini-3.7-flash")?.defaultVariant, "high");
	});

	it("returns empty catalog by default", () => {
		assert.equal(toPiModels().models.length, 0);
	});
});

describe("discoverModels", () => {
	it("returns empty when config missing", async () => {
		const result = await discoverModels({
			configPath: "/tmp/pi-agent-bridge-no-models.json",
		});
		assert.equal(result.models.length, 0);
	});
});

describe("buildThinkingLevelMap", () => {
	it("maps only suffixes that match pi level names", () => {
		const map = buildThinkingLevelMap(["high", "low"]);
		assert.equal(map.off, null);
		assert.equal(map.minimal, null);
		assert.equal(map.low, "low");
		assert.equal(map.medium, null);
		assert.equal(map.high, "high");
		assert.equal(map.xhigh, null);
		assert.equal(map.max, null);
	});

	it("exposes low/medium/high when all three exist", () => {
		const map = buildThinkingLevelMap(["high", "medium", "low"]);
		assert.equal(map.low, "low");
		assert.equal(map.medium, "medium");
		assert.equal(map.high, "high");
		assert.equal(map.xhigh, null);
		assert.equal(map.max, null);
	});
});
