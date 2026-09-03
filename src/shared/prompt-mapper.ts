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
 * Prepend a pi compaction summary to seed a fresh agy session after reset.
 * Returns prompt unchanged when summary is empty.
 */
export function withCompactSummaryPrefix(prompt: string, summary?: string): string {
  const body = summary?.trim();
  if (!body) return prompt;
  if (!prompt) return `[Previous session summary]\n${body}`;
  return `[Previous session summary]\n${body}\n\n---\n\n${prompt}`;
}

/**
 * Build full-history segment for a fresh agy conversation.
 * Serializes every message except the trailing current user request
 * (appended separately as [Current request]).
 * Messages already carried by excludeText (e.g. a consumed compaction
 * seed) are dropped to avoid duplicate injection.
 * Returns null when there is no history to inject.
 */
export function buildFullHistorySegment(messages: Message[], excludeText?: string): string | null {
  let history = messages;
  const last = messages[messages.length - 1];
  if (last?.role === "user") history = messages.slice(0, -1);
  const excluded = excludeText?.trim() ?? "";
  const dropDuplicated = excluded.length >= 32;
  const serialized = history
    .filter((msg) => !dropDuplicated || !extractText(msg).includes(excluded))
    .map(serializeMessage)
    .filter((s) => s.trim().length > 0);
  if (serialized.length === 0) return null;
  const header = `[Conversation history — ${serialized.length} message(s)]`;
  return `${header}\n${serialized.join("\n\n")}`;
}

/** Provider ids owned by this bridge ("agy" = pre-rename id, still in old sessions). */
const AGY_PROVIDERS: ReadonlySet<string> = new Set(["antigravity", "agy"]);

export function isAgyProvider(provider: string | undefined): boolean {
  return provider !== undefined && AGY_PROVIDERS.has(provider);
}

/**
 * Whether the latest assistant turn came from a non-agy provider.
 * Detection only (no serialization): single reverse scan.
 * Returns false when there is no assistant turn yet.
 */
export function isLastAssistantForeign(messages: Message[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role === "assistant") return !isAgyProvider(msg.provider);
  }
  return false;
}

/**
 * Assemble final prompt from a history segment and the latest request.
 * Shared by inline and file-spill paths (spill passes its directive as segment).
 */
export function assembleHistoryPrompt(segment: string | null, latest: string): string {
  if (!segment) return latest;
  if (!latest) return segment;
  return `${segment}\n\n---\n\n[Current request]\n${latest}`;
}

/**
 * Build the file-spill directive replacing an over-threshold history segment.
 * Pure: file writing and threshold comparison live with the caller.
 */
export function buildFileDirective(relPath: string, byteLength: number, preview: string): string {
  return `[Conversation history — ${byteLength} bytes, saved to file://${relPath} — read it before answering]\n${preview}`;
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
