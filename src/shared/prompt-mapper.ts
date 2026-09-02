import type { AssistantMessage, Message } from "@earendil-works/pi-ai";

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

/**
 * Build prompt with gap injection for agy pool.
 * If the last antigravity turn exists and there are messages after it (from other providers),
 * prepend serialized gap as context header + latest user request.
 * Otherwise returns same as mapPrompt (no gap).
 */
export function mapPromptWithGap(messages: Message[]): string {
  const latest = mapPrompt(messages);
  const gap = buildGapSegment(messages);
  if (!gap) return latest;
  if (!latest) return gap;
  return `${gap}\n\n---\n\n[Current request]\n${latest}`;
}

/** Serialized gap header or null when no gap. Exported for testing. */
export function buildGapSegment(messages: Message[]): string | null {
  const lastAgyIdx = findLastAntigravityIndex(messages);
  if (lastAgyIdx === -1) return null;
  const after = messages.slice(lastAgyIdx + 1);
  if (after.length === 0) return null;
  // If gap is exactly one trailing user message (continuous agy), no gap to inject
  if (after.length === 1 && after[0]?.role === "user") return null;
  // Exclude trailing last user (current request) from gap; it will be appended separately
  let gapMessages = after;
  const last = after[after.length - 1];
  if (last?.role === "user") {
    gapMessages = after.slice(0, -1);
    if (gapMessages.length === 0) return null;
  }
  const serialized = gapMessages.map(serializeMessage).filter((s) => s.trim().length > 0);
  if (serialized.length === 0) return null;
  const header = `[Context since last antigravity turn — ${serialized.length} message(s) from other providers]`;
  return `${header}\n${serialized.join("\n\n")}`;
}

function findLastAntigravityIndex(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role === "assistant" && msg.provider === "antigravity") {
      return i;
    }
  }
  return -1;
}

export function serializeMessage(msg: Message): string {
  if (msg.role === "user") {
    const text = extractText(msg);
    return `[User]\n${text}`;
  }
  if (msg.role === "assistant") {
    const provider = msg.provider ?? "unknown";
    const model = msg.model ?? "";
    const label = model
      ? `[Assistant provider=${provider} model=${model}]`
      : `[Assistant provider=${provider}]`;
    const text = serializeAssistantContent(msg.content);
    return `${label}\n${text}`;
  }
  if (msg.role === "toolResult") {
    const errMark = msg.isError ? " (error)" : "";
    const label = `[ToolResult ${msg.toolName} id=${msg.toolCallId}${errMark}]`;
    const text = extractToolResultText(msg);
    return `${label}\n${text}`;
  }
  return "";
}

function serializeAssistantContent(parts: AssistantMessage["content"]): string {
  const out: string[] = [];
  for (const p of parts) {
    if (p.type === "text" && typeof p.text === "string") out.push(p.text);
    else if (p.type === "thinking" && typeof (p as { thinking?: string }).thinking === "string")
      out.push(`[thinking] ${(p as { thinking: string }).thinking}`);
    else if (p.type === "toolCall")
      out.push(
        `[toolCall ${(p as { name: string }).name ?? ""} id=${(p as { id: string }).id ?? ""}] ${JSON.stringify((p as { arguments: unknown }).arguments ?? {})}`,
      );
  }
  return out.join("\n");
}

function extractToolResultText(msg: Message): string {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return (msg.content as Array<{ type: string; text?: string }>)
      .filter((part) => part.type === "text")
      .map((part) => part.text ?? "")
      .join("\n");
  }
  return "";
}

function extractTask(raw: string): string {
  let t = raw.trim();
  if (t.startsWith("Task: ")) t = t.slice(6).trimStart();
  const cutMarkers = [
    "\n---\n",
    "\n**Output:**",
    "**Output:**",
    "## Acceptance Contract",
    "```acceptance-report",
  ];
  for (const m of cutMarkers) {
    const idx = t.indexOf(m);
    if (idx !== -1) t = t.slice(0, idx).trimEnd();
  }
  return t.trim();
}

function extractText(msg: Message): string {
  if (typeof msg.content === "string") return msg.content;
  return msg.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}
