import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { boundTurnMessages, mapPrompt } from "../src/prompt-mapper.ts";
import type { Message } from "@earendil-works/pi-ai";

describe("mapPrompt", () => {
  it("single user message is raw text", () => {
    const messages: Message[] = [
      { role: "user", content: "hello", timestamp: 1 },
    ];
    assert.equal(mapPrompt(messages), "hello");
  });

  it("multi-message wraps history and current request", () => {
    const messages: Message[] = [
      { role: "user", content: "hello", timestamp: 1 },
      {
        role: "assistant",
        content: [{ type: "text", text: "hi" }],
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
        timestamp: 2,
      },
      { role: "user", content: "again", timestamp: 3 },
    ];
    const result = mapPrompt(messages);
    assert.match(result, /\[Previous Conversation Context\]/);
    assert.match(result, /User: hello/);
    assert.match(result, /Assistant: hi/);
    assert.match(result, /Current Request:/);
    assert.match(result, /again/);
  });
});

describe("boundTurnMessages", () => {
  it("returns messages after last assistant", () => {
    const messages: Message[] = [
      { role: "user", content: "a", timestamp: 1 },
      {
        role: "assistant",
        content: [{ type: "text", text: "b" }],
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
        timestamp: 2,
      },
      { role: "user", content: "c", timestamp: 3 },
    ];
    const bound = boundTurnMessages(messages);
    assert.equal(bound.length, 1);
    assert.equal(bound[0]?.role, "user");
    if (bound[0]?.role === "user") assert.equal(bound[0].content, "c");
  });
});
