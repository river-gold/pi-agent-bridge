import { describe, expect, it } from "vitest";
import { extractDelta } from "../src/agy/extract-delta.ts";

describe("extractDelta", () => {
	it("returns full text when not conversation bound", () => {
		expect(extractDelta("old", "oldnew", false)).toBe("oldnew");
	});

	it("strips exact prefix", () => {
		expect(extractDelta("turn one\n", "turn one\nturn two", true)).toBe(
			"turn two",
		);
	});

	it("handles empty prev", () => {
		expect(extractDelta("", "any", true)).toBe("any");
	});

	it("returns full when no match", () => {
		expect(extractDelta("aaa", "bbb", true)).toBe("bbb");
	});
});
