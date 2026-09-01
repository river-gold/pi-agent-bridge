import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractDelta } from "../src/agy/extract-delta.ts";

describe("extractDelta", () => {
	it("returns full text when not conversation bound", () => {
		assert.equal(extractDelta("old", "oldnew", false), "oldnew");
	});

	it("strips exact prefix", () => {
		assert.equal(
			extractDelta("turn one\n", "turn one\nturn two", true),
			"turn two",
		);
	});

	it("handles empty prev", () => {
		assert.equal(extractDelta("", "any", true), "any");
	});

	it("returns full when no match", () => {
		assert.equal(extractDelta("aaa", "bbb", true), "bbb");
	});
});
