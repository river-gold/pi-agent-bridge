import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapPrompt } from "../src/agy/prompt-mapper.ts";
import { mapPrompt as sharedMapPrompt } from "../src/shared/prompt-mapper.ts";
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

  describe("[Read from:...] filtering (agy extension)", () => {
    it("strips single leading [Read from:...] prefix", () => {
      const messages: Message[] = [
        { role: "user", content: "[Read from: /Users/younwoo/.pi/agent/AGENTS.md] hello", timestamp: 1 },
      ];
      assert.equal(mapPrompt(messages), "hello");
    });

    it("strips multiple leading [Read from:...] prefixes", () => {
      const messages: Message[] = [
        { role: "user", content: "[Read from: /a] [Read from: /b] real task", timestamp: 1 },
      ];
      assert.equal(mapPrompt(messages), "real task");
    });

    it("strips prefix with surrounding whitespace and newlines", () => {
      const messages: Message[] = [
        { role: "user", content: "  [Read from: /a]   \n  real content", timestamp: 1 },
      ];
      assert.equal(mapPrompt(messages), "real content");
    });

    it("falls back to previous user message when latest is only prefix", () => {
      const messages: Message[] = [
        { role: "user", content: "old task", timestamp: 1 },
        assistant("reply"),
        { role: "user", content: "[Read from: /Users/younwoo/.pi/agent/AGENTS.md]", timestamp: 3 },
      ];
      assert.equal(mapPrompt(messages), "old task");
    });

    it("returns empty when only prefix and no history", () => {
      const messages: Message[] = [
        { role: "user", content: "[Read from: /a]", timestamp: 1 },
      ];
      assert.equal(mapPrompt(messages), "");
    });

    it("still applies shared logic: Task: prefix after Read from", () => {
      const messages: Message[] = [
        { role: "user", content: "[Read from: /a] Task: hello", timestamp: 1 },
      ];
      assert.equal(mapPrompt(messages), "hello");
    });

    it("still applies shared logic: cutMarkers after stripping", () => {
      const messages: Message[] = [
        { role: "user", content: "[Read from: /a] hello\n---\nignore this", timestamp: 1 },
      ];
      assert.equal(mapPrompt(messages), "hello");
    });

    it("handles content array with Read from in text part", () => {
      const messages: Message[] = [
        {
          role: "user",
          content: [{ type: "text", text: "[Read from: /a] array task" }],
          timestamp: 1,
        },
      ];
      assert.equal(mapPrompt(messages), "array task");
    });
  });

  describe("shared logic preserved", () => {
    it("shared mapPrompt does NOT strip [Read from:...]", () => {
      const messages: Message[] = [
        { role: "user", content: "[Read from: /a] hello", timestamp: 1 },
      ];
      assert.equal(sharedMapPrompt(messages), "[Read from: /a] hello");
    });

    it("shared still handles Task: and cutMarkers", () => {
      const messages: Message[] = [
        { role: "user", content: "Task: hello\n---\nignore", timestamp: 1 },
      ];
      assert.equal(sharedMapPrompt(messages), "hello");
      assert.equal(mapPrompt(messages), "hello");
    });
  });
});
