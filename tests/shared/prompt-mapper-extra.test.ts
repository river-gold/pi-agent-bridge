import type { Message } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { mapPrompt } from "../../src/shared/prompt-mapper.ts";

describe("prompt-mapper extra", () => {
  it("strips Task: prefix", () => {
    expect(mapPrompt([{ role: "user", content: "Task: hello", timestamp: 1 }])).toBe("hello");
  });
  it("cuts markers", () => {
    expect(mapPrompt([{ role: "user", content: "keep\n---\ncut", timestamp: 1 }])).toBe("keep");
    expect(mapPrompt([{ role: "user", content: "keep\n**Output:** cut", timestamp: 1 }])).toBe("keep");
    expect(mapPrompt([{ role: "user", content: "keep**Output:**cut", timestamp: 1 }])).toBe("keep");
    expect(mapPrompt([{ role: "user", content: "keep## Acceptance Contract cut", timestamp: 1 }])).toBe("keep");
    expect(mapPrompt([{ role: "user", content: "keep```acceptance-report cut", timestamp: 1 }])).toBe("keep");
  });
  it("extractText string content", () => {
    expect(mapPrompt([{ role: "user", content: "string content", timestamp: 1 } as Message])).toBe("string content");
  });
  it("extractText array filters non-text", () => {
    const msg: Message = {
      role: "user",
      content: [
        { type: "text", text: "a" },
        { type: "image", url: "x" } as unknown as { type: "text"; text: string },
        { type: "text", text: "b" },
      ],
      timestamp: 1,
    };
    expect(mapPrompt([msg])).toBe("a\nb");
  });
  it("non-user extractText returns empty via mapPrompt", () => {
    const msg: Message = { role: "user", content: [{ type: "text", text: "  spaced  " }], timestamp: 1 };
    expect(mapPrompt([msg])).toBe("spaced");
  });
  it("skips missing messages", () => {
    expect(mapPrompt([undefined as unknown as Message])).toBe("");
  });
});
