import type { Message } from "@earendil-works/pi-ai";

export function boundTurnMessages(messages: Message[]): Message[] {
  let lastAssistantIdx = -1;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.role === "assistant") lastAssistantIdx = i;
  }
  if (lastAssistantIdx === -1) return messages;
  return messages.slice(lastAssistantIdx + 1);
}

export function mapPrompt(messages: Message[]): string {
  if (messages.length === 0) return "";
  if (messages.length === 1) return extractText(messages[0]!).trim();

  const parts: string[] = [];
  const history = messages.slice(0, -1);
  const current = messages[messages.length - 1]!;

  parts.push("[Previous Conversation Context]");
  for (const msg of history) {
    const text = extractText(msg);
    if (!text.trim()) continue;
    const label =
      msg.role === "user" ? "User" : msg.role === "assistant" ? "Assistant" : "Tool";
    parts.push(`${label}: ${text}`);
  }
  parts.push("[End of Context]");

  const currentText = extractText(current).trim();
  if (currentText) {
    parts.push("");
    parts.push("Current Request:");
    parts.push(currentText);
  }

  return parts.join("\n");
}

function extractText(msg: Message): string {
  if (msg.role === "user") {
    if (typeof msg.content === "string") return msg.content;
    return msg.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
  }

  if (msg.role === "assistant") {
    return msg.content
      .map((part) => {
        if (part.type === "text") return part.text;
        if (part.type === "thinking") return part.thinking;
        if (part.type === "toolCall") {
          return `[toolCall ${part.name}(${JSON.stringify(part.arguments)})]`;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  return msg.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}
