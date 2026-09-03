import type { Message } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
  assembleHistoryPrompt,
  buildFileDirective,
  buildFullHistorySegment,
  isLastAssistantForeign,
  mapPrompt,
  serializeMessage,
} from "../../src/shared/prompt-mapper.ts";

const user = (text: string): Message => ({ role: "user", content: text, timestamp: 1 });
const assistant = (provider: string, text: string, model = "m"): Message => ({
  role: "assistant",
  content: [{ type: "text", text }],
  api: "openai-completions",
  provider: provider,
  model,
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

describe("buildFullHistorySegment", () => {
  it("serializes everything except trailing current request", () => {
    const msgs: Message[] = [user("hi"), assistant("openai", "hey"), user("do it")];
    const segment = buildFullHistorySegment(msgs)!;
    expect(segment).toContain("[Conversation history — 2 message(s)]");
    expect(segment).toContain("hi");
    expect(segment).toContain("hey");
    expect(segment).not.toContain("do it");
  });

  it("returns null when only the current request exists", () => {
    expect(buildFullHistorySegment([user("do it")])).toBeNull();
    expect(buildFullHistorySegment([])).toBeNull();
  });

  it("keeps all messages when the last one is not a user turn", () => {
    const msgs: Message[] = [user("hi"), assistant("openai", "hey")];
    const segment = buildFullHistorySegment(msgs)!;
    expect(segment).toContain("hi");
    expect(segment).toContain("hey");
  });

  it("drops messages already carried by excludeText (compaction seed)", () => {
    const summary =
      "The conversation history before this point was compacted. Did X then Y with detailed plan.";
    const msgs: Message[] = [
      user(
        `The conversation history before this point was compacted into the following summary: ${summary}`,
      ),
      user("after compact"),
      assistant("openai", "ok"),
      user("do it"),
    ];
    const segment = buildFullHistorySegment(msgs, summary)!;
    expect(segment).toContain("[Conversation history — 2 message(s)]");
    expect(segment).not.toContain(summary);
    expect(segment).toContain("after compact");
  });

  it("ignores short excludeText", () => {
    const msgs: Message[] = [user("hi"), user("do it")];
    const segment = buildFullHistorySegment(msgs, "hi")!;
    expect(segment).toContain("hi");
  });
});

describe("isLastAssistantForeign", () => {
  it("detects non-agy turns after the last agy turn", () => {
    const msgs: Message[] = [
      user("hi"),
      assistant("antigravity", "r1"),
      user("q2"),
      assistant("openai", "other"),
      user("final"),
    ];
    expect(isLastAssistantForeign(msgs)).toBe(true);
  });

  it("treats pre-rename agy provider id as own", () => {
    const msgs: Message[] = [user("hi"), assistant("agy", "r1"), user("next")];
    expect(isLastAssistantForeign(msgs)).toBe(false);
  });

  it("detects foreign activity after pre-rename agy turns", () => {
    const msgs: Message[] = [
      user("hi"),
      assistant("agy", "r1"),
      assistant("openai", "other"),
      user("final"),
    ];
    expect(isLastAssistantForeign(msgs)).toBe(true);
  });

  it("ignores continuous agy usage", () => {
    const msgs: Message[] = [user("hi"), assistant("antigravity", "r1"), user("next")];
    expect(isLastAssistantForeign(msgs)).toBe(false);
  });

  it("returns false with no assistant turn yet", () => {
    expect(isLastAssistantForeign([user("hi")])).toBe(false);
    expect(isLastAssistantForeign([])).toBe(false);
  });
});

describe("assembleHistoryPrompt", () => {
  it("combines segment and latest request", () => {
    const prompt = assembleHistoryPrompt("[seg]", "do it");
    expect(prompt).toContain("[seg]");
    expect(prompt).toContain("[Current request]");
    expect(prompt.endsWith("do it")).toBe(true);
  });

  it("passes through when one side is empty", () => {
    expect(assembleHistoryPrompt(null, "do it")).toBe("do it");
    expect(assembleHistoryPrompt("[seg]", "")).toBe("[seg]");
  });
});

describe("buildFileDirective", () => {
  it("references path, size, and preview", () => {
    const directive = buildFileDirective(".temp/h.md", 99999, "prev");
    expect(directive).toContain("file://.temp/h.md");
    expect(directive).toContain("99999");
    expect(directive).toContain("prev");
    expect(mapPrompt([user("latest")])).toBe("latest");
  });
});

describe("serializeMessage", () => {
  it("serializes toolCall inside assistant", () => {
    const asstWithTool: Message = {
      role: "assistant",
      content: [
        { type: "text", text: "call" },
        { type: "toolCall", id: "c1", name: "run_command", arguments: { CommandLine: "ls" } },
      ],
      api: "openai-completions",
      provider: "openai",
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
    };
    const s = serializeMessage(asstWithTool);
    expect(s).toContain("run_command");
    expect(s).toContain("ls");
  });
});
