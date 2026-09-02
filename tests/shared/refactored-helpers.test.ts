import { describe, it, expect } from "vitest";
import { hasBoundary, extractTailDelta } from "../../src/agy/extract-delta.ts";
import { isStale } from "../../src/shared/session-store.ts";
import {
  parseAgyLine,
  handleAgentResponse,
  type AgentResponsePending,
} from "../../src/agy/agy-pool.ts";

describe("refactored helpers", () => {
  it("hasBoundary out of bounds", () => {
    expect(hasBoundary("hi", "", 0)).toBe(true);
    expect(hasBoundary("helloworld", "hello", 0)).toBe(false);
    expect(hasBoundary("hello", "hello", 0)).toBe(true);
    expect(hasBoundary("hello world", "hello", 0)).toBe(true);
    expect(hasBoundary("hello\n", "hello\n", 0)).toBe(true);
    expect(hasBoundary("hello", "hello", 5)).toBe(true);
  });
  it("extractTailDelta", () => {
    expect(extractTailDelta("hello", "short")).toBeNull();
    expect(extractTailDelta("hello", "")).toBeNull();
    // tail >=20 and output starts with tail
    const tail = "A".repeat(30);
    const prev = "A".repeat(200);
    // tail for prev is 150 A's, output is 150 A's + " rest" => should return "rest"
    expect(extractTailDelta("A".repeat(150) + " rest", prev)).toBe("rest");
    // firstToken endsWith tail
    const prev2 = "A".repeat(200) + tail;
    const output2 = "prefix-" + "A".repeat(120) + tail + " rest";
    expect(typeof extractTailDelta(output2, prev2)).toBe("string");
    // firstToken null
    expect(extractTailDelta("   ", "A".repeat(200))).toBeNull();
  });
  it("isStale", () => {
    const now = Date.now();
    expect(isStale(now - 100000, 1000)).toBe(true);
    expect(isStale(now, 100000)).toBe(false);
  });
  it("parseAgyLine", () => {
    expect(parseAgyLine("not json")).toBeNull();
    expect(parseAgyLine("{ bad")).toBeNull();
    expect(parseAgyLine(JSON.stringify({ foo: "bar" }))).toBeNull();
    expect(parseAgyLine(JSON.stringify({ event: "init", conversation_id: "c1" }))).toEqual({
      event: "init",
      conversation_id: "c1",
    });
  });
  it("handleAgentResponse", () => {
    const pending: AgentResponsePending = {
      accumulatedText: "hello",
      onEvent: () => {},
      streamError: undefined,
    };
    handleAgentResponse(pending, "agent_response", "hi", "ACTIVE", undefined);
    expect(pending.accumulatedText).toBe("hellohi");
    pending.accumulatedText = "hello";
    handleAgentResponse(pending, "agent_response", "hello world", "DONE", "DONE");
    // Actually state DONE will take first branch, not second
    // Test status DONE with mismatch
    pending.accumulatedText = "hello";
    pending.streamError = undefined;
    handleAgentResponse(pending, "agent_response", "world", undefined, "DONE");
    expect(pending.streamError).toBeDefined();
    // Test with suffix
    pending.accumulatedText = "hello";
    pending.streamError = undefined;
    handleAgentResponse(pending, "agent_response", "hello world", undefined, "DONE");
    expect(pending.accumulatedText).toBe("hello world");
  });
});
