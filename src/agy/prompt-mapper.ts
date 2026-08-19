import type { Message } from "@earendil-works/pi-ai";

/**
 * Extract only the latest user-typed text.
 * History / tool dumps / assistant turns stay in the agy conversation binding,
 * not re-serialized into the prompt.
 */
export function mapPrompt(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role === "user") {
      return extractText(msg).trim();
    }
  }
  return "";
}

function extractText(msg: Message): string {
  if (msg.role !== "user") return "";
  if (typeof msg.content === "string") return msg.content;
  return msg.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}
