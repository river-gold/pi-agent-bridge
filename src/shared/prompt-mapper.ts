import type { Message } from "@earendil-works/pi-ai";

/**
 * Extract only the latest user-typed text.
 * History / tool dumps / assistant turns stay in the agent conversation binding,
 * not re-serialized into the prompt.
 */
export function mapPrompt(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role === "user") {
      return extractTask(extractText(msg));
    }
  }
  return "";
}

export function extractTask(raw: string): string {
  let t = raw.trim();
  if (t.startsWith("Task: ")) t = t.slice(6).trimStart();
  const cutMarkers = ["\n---\n", "\n**Output:**", "**Output:**", "## Acceptance Contract", "```acceptance-report"];
  for (const m of cutMarkers) {
    const idx = t.indexOf(m);
    if (idx !== -1) t = t.slice(0, idx).trimEnd();
  }
  return t.trim();
}

export function extractText(msg: Message): string {
  if (msg.role !== "user") return "";
  if (typeof msg.content === "string") return msg.content;
  return msg.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}
