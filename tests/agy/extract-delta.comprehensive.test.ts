import { describe, expect, it } from "vitest";
import {
  extractDelta,
  hasBoundary,
  normalizeInput,
  stripWarnings,
  extractTailDelta,
  isConversationBound,
  getFirstTokenStart,
} from "../../src/agy/extract-delta.ts";

describe("extractDelta comprehensive", () => {
  it("not bound or empty prev", () => {
    expect(extractDelta("old", "oldnew", false)).toBe("oldnew");
    expect(extractDelta("", "any", true)).toBe("any");
  });
  it("exact prefix and trimEnd", () => {
    expect(extractDelta("turn one\n", "turn one\nturn two", true)).toBe("turn two");
    expect(extractDelta("turn one  \n", "turn one\nturn two", true)).toBe("turn two");
    expect(extractDelta("aaa", "bbb", true)).toBe("bbb");
  });
  it("warnings", () => {
    expect(extractDelta("hello", "WARNING: ignored\nhello world", true).trim()).toBe("world");
    expect(extractDelta("hello", "...TRUNCATED...\nhello world", true).trim()).toBe("world");
  });
  it("lastLine", () => {
    const prev = "line one\nline two is long enough here";
    const full = "line two is long enough here\nnext part";
    expect(extractDelta(prev, full, true)).toBe("next part");
    // short last line not triggered
    expect(extractDelta("a\nb", "xyz", true)).toBe("xyz");
  });
  it("tail startsWith", () => {
    const prev = "A".repeat(200);
    const tail = "A".repeat(150);
    expect(extractDelta(prev, tail + " rest", true).trim()).toBe("rest");
    // hasBoundary false
    expect(extractDelta(prev, tail + "X", true)).toBe(tail + "X");
  });
  it("tail firstToken and null", () => {
    const tail = "B".repeat(30);
    const prev = "A".repeat(200) + tail;
    const full = "prefix-" + "A".repeat(120) + tail + " rest";
    expect(typeof extractDelta(prev, full, true)).toBe("string");
    expect(extractDelta("A".repeat(200), "   ", true)).toBe("   ");
    expect(extractDelta("A".repeat(200), "", true)).toBe("");
  });
  it("isConversationBound", () => {
    expect(isConversationBound(false, "hello")).toBe(false);
    expect(isConversationBound(false, "")).toBe(false);
    expect(isConversationBound(true, "")).toBe(false);
    expect(isConversationBound(true, "hello")).toBe(true);
  });
  it("helpers", () => {
    expect(normalizeInput("a\r\nb")).toBe("a\nb");
    expect(stripWarnings("WARNING: hi\nhello")).toBe("hello");
    expect(hasBoundary("helloworld", "hello", 0)).toBe(false);
    expect(hasBoundary("hello world", "hello", 0)).toBe(true);
    expect(hasBoundary("hello\n", "hello\n", 0)).toBe(true);
    expect(hasBoundary("abc", "", 0)).toBe(true);
    expect(hasBoundary("hello", "hello", 0)).toBe(true);
    expect(hasBoundary("hello", "hello", 5)).toBe(true);
    expect(getFirstTokenStart(null)).toBe(0);
    expect(getFirstTokenStart(null)).toBe(0);
    expect(
      extractTailDelta("hello world output", "completely different previous text over 20 chars"),
    ).toBeNull();
    expect(extractTailDelta("hello", "short")).toBeNull();
    expect(extractTailDelta("A".repeat(150) + " rest", "A".repeat(200))).toBe("rest");
  });
});
