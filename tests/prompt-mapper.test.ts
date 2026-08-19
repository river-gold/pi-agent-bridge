import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapPrompt } from "../src/prompt-mapper.ts";
import type { Message } from "@earendil-works/pi-ai";

const assistant = (text: string): Message => ({
  role: "assistant",
  content: [{ type: "text", text }],
  api: "agy-cli",
  provider: "agy",
  model: "m",
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "stop",
  timestamp: 1,
});

describe("mapPrompt", () => {
  it("returns single user message as-is", () => {
    const messages: Message[] = [
      { role: "user", content: "hello", timestamp: 1 },
    ];
    assert.equal(mapPrompt(messages), "hello");
  });

  it("ignores history and returns only latest user text", () => {
    const messages: Message[] = [
      { role: "user", content: "old", timestamp: 1 },
      assistant("reply"),
      { role: "user", content: "only this", timestamp: 3 },
    ];
    assert.equal(mapPrompt(messages), "only this");
  });

  it("ignores tool results after last user", () => {
    const messages: Message[] = [
      { role: "user", content: "do it", timestamp: 1 },
      assistant("calling tool"),
      {
        role: "toolResult",
        toolCallId: "1",
        toolName: "bash",
        content: [{ type: "text", text: "huge output" }],
        isError: false,
        timestamp: 3,
      },
    ];
    assert.equal(mapPrompt(messages), "do it");
  });

  it("returns empty when no user message", () => {
    assert.equal(mapPrompt([assistant("x")]), "");
  });
});
