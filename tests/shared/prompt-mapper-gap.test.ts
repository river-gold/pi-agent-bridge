import type { Message } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
  buildGapSegment,
  mapPromptWithGap,
  serializeMessage,
} from "../../src/shared/prompt-mapper.ts";

const user = (text: string): Message => ({ role: "user", content: text, timestamp: 1 });
const assistant = (provider: string, text: string, model = "m"): Message => ({
  role: "assistant",
  content: [{ type: "text", text }],
  api: "openai-completions",
  provider: provider as never,
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
const toolResult = (name: string, text: string, isError = false): Message =>
  ({
    role: "toolResult",
    toolCallId: "c1",
    toolName: name,
    content: [{ type: "text", text }],
    isError,
    timestamp: 1,
  }) as unknown as Message;

describe("mapPromptWithGap", () => {
  it("continuous agy -> no gap, returns latest user only", () => {
    const msgs: Message[] = [user("hi"), assistant("antigravity", "r1"), user("next")];
    expect(buildGapSegment(msgs)).toBeNull();
    expect(mapPromptWithGap(msgs)).toBe("next");
  });

  it("other provider gap includes user/assistant/toolResult", () => {
    const msgs: Message[] = [
      user("hi"),
      assistant("antigravity", "agy reply"),
      user("q2"),
      assistant("openai", "other"),
      toolResult("bash", "out"),
      user("final"),
    ];
    const gap = buildGapSegment(msgs)!;
    expect(gap).toContain("[User]");
    expect(gap).toContain("q2");
    expect(gap).toContain("[Assistant provider=openai");
    expect(gap).toContain("other");
    expect(gap).toContain("[ToolResult bash");
    expect(gap).toContain("out");
    const prompt = mapPromptWithGap(msgs);
    expect(prompt).toContain("[Context since last antigravity turn");
    expect(prompt).toContain("[Current request]");
    expect(prompt.endsWith("final")).toBe(true);
  });

  it("no prior agy -> no gap", () => {
    const msgs: Message[] = [user("hi"), assistant("openai", "x"), user("y")];
    expect(buildGapSegment(msgs)).toBeNull();
    expect(mapPromptWithGap(msgs)).toBe("y");
  });

  it("single trailing user after agy -> no gap", () => {
    const msgs: Message[] = [assistant("antigravity", "hi"), user("next")];
    expect(buildGapSegment(msgs)).toBeNull();
  });

  it("compaction summary preserved in gap", () => {
    const msgs: Message[] = [
      user("hi"),
      assistant("antigravity", "r"),
      user("summary: compacted conversation"),
      assistant("openai", "ok"),
      user("final"),
    ];
    const gap = buildGapSegment(msgs)!;
    expect(gap).toContain("summary: compacted conversation");
  });

  it("serializes toolCall inside assistant", () => {
    const asstWithTool: Message = {
      role: "assistant",
      content: [
        { type: "text", text: "call" },
        { type: "toolCall", id: "c1", name: "run_command", arguments: { CommandLine: "ls" } },
      ] as never,
      api: "openai-completions",
      provider: "openai" as never,
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

  it("gap without trailing user serializes all after", () => {
    // edge: messages end with assistant (no final user) - should still serialize gap
    const msgs: Message[] = [
      user("hi"),
      assistant("antigravity", "r1"),
      user("q2"),
      assistant("openai", "ans"),
    ];
    const gap = buildGapSegment(msgs);
    // after agy: [q2, ans] -> gapMessages = [q2, ans] (no trailing user removal because last is assistant)
    expect(gap).toContain("q2");
    expect(gap).toContain("ans");
  });
});
