/**
 * Antigravity (agy) pooled provider for pi — long-lived stdin/stdout pool.
 *
 * Id: antigravity (long-lived pool, replaces per-turn agy -p)
 * Pool keys by composite (sessionId::hash(cwd)) to isolate workspaces.
 *
 * Env:
 *   AGY_BINARY, AGY_TIMEOUT_MS, AGY_EXTRA_ARGS, AGY_CONVERSATIONS_DIR (shared with agy)
 *   AGY_POOL_IDLE_MS       idle eviction ms (default 300000 = 5m)
 *   AGY_POOL_MAX_SIZE      max pooled processes (default 20)
 *   AGY_INPUT_HISTORY_THRESHOLD  full-history inline limit in bytes (default 51200)
 *   AGY_INPUT_HISTORY_PREVIEW    preview chars in file-spill directive (default 2000)
 *
 * Security:
 *   Same as agy: --dangerously-skip-permissions, --add-dir cwd
 */
import {
  createProvider,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { discoverModels } from "../src/agy/agy-models.ts";
import { loadConfig } from "../src/agy/config.ts";
import { SessionStore } from "../src/agy/session-store.ts";
import {
  assembleHistoryPrompt,
  buildFileDirective,
  buildFullHistorySegment,
  isLastAssistantForeign,
  mapPrompt,
  withCompactSummaryPrefix,
} from "../src/agy/prompt-mapper.ts";
import { resolveAgyModelId, type AgyModelMeta } from "../src/agy/agy-models.ts";
import { findNewConversation, snapshot } from "../src/agy/conversation-tracker.ts";
import { extractDelta } from "../src/agy/extract-delta.ts";
import {
  calculateCost,
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Api,
} from "@earendil-works/pi-ai";
import {
  AgyPool,
  compositeKey,
  type AgyStreamEvent,
  type RunPooledResult,
} from "../src/agy/agy-pool.ts";
import type { AgyConfig } from "../src/agy/config.ts";

export interface PoolRuntimeHandle {
  prompt: (
    prompt: string,
    options?: {
      signal?: AbortSignal;
      timeoutMs?: number;
      onEvent?: (event: AgyStreamEvent) => void;
    },
  ) => Promise<RunPooledResult>;
}

export interface PoolRuntimePool {
  peekModelEffort: (key: string) => { model?: string; effort?: string } | undefined;
  has: (key: string) => boolean;
  disposeKey: (key: string) => Promise<boolean>;
  acquire: (
    sessionKey: string | undefined,
    cwd: string,
    model?: string,
    effort?: string,
    conversationId?: string,
  ) => PoolRuntimeHandle;
}

export interface PoolRuntimeStoreEntry {
  conversationId: string | null;
  prevOutput?: string;
  model?: string;
  effort?: string;
}

export interface PoolRuntimeStore {
  getEntry: (key: string) => Promise<PoolRuntimeStoreEntry | null>;
  acquireBindingLock: (options?: {
    abortSignal?: AbortSignal;
    timeoutMs?: number;
  }) => Promise<() => Promise<void>>;
  set: (
    key: string,
    conversationId: string | null,
    prevOutput?: string,
    model?: string,
    effort?: string,
  ) => Promise<void>;
}

export interface PoolRuntime {
  config: AgyConfig;
  getCwd: () => string;
  getMeta: (modelId: string) => AgyModelMeta | undefined;
  store: PoolRuntimeStore;
  pool: PoolRuntimePool;
}

const prevOutputs = new Map<string, string>();

/** One-shot compaction summaries, keyed by poolKey. Consumed on the next turn after reset. */
const compactSeeds = new Map<string, string>();

export function setCompactSeed(poolKey: string, summary: string): void {
  const body = summary?.trim();
  if (!body) return;
  compactSeeds.set(poolKey, body);
}

export function consumeCompactSeed(poolKey: string): string | undefined {
  const seed = compactSeeds.get(poolKey);
  if (seed === undefined) return undefined;
  compactSeeds.delete(poolKey);
  return seed;
}

export interface SessionResetDeps {
  disposeKey: (key: string) => Promise<unknown>;
  set: (key: string, conversationId: string | null, prevOutput?: string) => Promise<unknown>;
}

export type CompactionResetDeps = SessionResetDeps;

export async function resetSessionState(deps: SessionResetDeps, poolKey: string): Promise<void> {
  await deps.disposeKey(poolKey).catch(() => false);
  await deps.set(poolKey, null, "").catch(() => undefined);
  prevOutputs.delete(poolKey);
}

/** Drop agy-side state for a compacted session and stash pi's summary as a one-shot seed. */
export async function resetPoolForCompaction(
  deps: CompactionResetDeps,
  poolKey: string,
  summary: string | undefined,
): Promise<void> {
  await resetSessionState(deps, poolKey);
  setCompactSeed(poolKey, summary ?? "");
}

function emptyUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function createOutput(model: Model<Api>): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: emptyUsage(),
    stopReason: "pending",
    timestamp: Date.now(),
  };
}

function toPoolModels(models: Model<"openai-completions">[]): Model<"openai-completions">[] {
  // keep same api but set provider to antigravity so picker shows antigravity variant
  return models.map((m) => ({ ...m, provider: "antigravity" }));
}

export function streamAgyPool(
  runtime: PoolRuntime,
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  void (async () => {
    const output = createOutput(model);
    let releaseBindingLock: (() => Promise<void>) | null = null;
    try {
      stream.push({ type: "start", partial: output });
      const deadline = Date.now() + (options?.timeoutMs ?? runtime.config.timeoutMs);
      const remainingTimeout = () => {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error("agy timed out");
        return remaining;
      };

      const rawSessionId = options?.sessionId?.trim() || "default";
      const cwd = runtime.getCwd();
      const poolKey = compositeKey(rawSessionId, cwd);

      let entry = await runtime.store.getEntry(poolKey);
      remainingTimeout();
      let conversationId = entry?.conversationId ?? null;
      if (!conversationId) {
        try {
          releaseBindingLock = await runtime.store.acquireBindingLock({
            abortSignal: options?.signal,
            timeoutMs: remainingTimeout(),
          });
        } catch (error) {
          if (error instanceof Error && error.name === "TimeoutError")
            throw new Error("agy timed out", { cause: error });
          throw error;
        }
        entry = await runtime.store.getEntry(poolKey);
        remainingTimeout();
        conversationId = entry?.conversationId ?? null;
      }

      const resolved = resolveAgyModelId(model.id, options?.reasoning, runtime.getMeta(model.id));

      // Reset conversation when model/effort changed or another provider
      // was used since the last agy turn: full history is re-injected below.
      let wasReset = false;
      const prev = runtime.pool.peekModelEffort(poolKey);
      const modelChanged =
        prev !== undefined &&
        ((prev.model ?? undefined) !== (resolved.model ?? undefined) ||
          (prev.effort ?? undefined) !== (resolved.effort ?? undefined));
      // Stored model/effort covers pool eviction: live entry may be gone
      // while the conversation binding survives in the store.
      const storedModelChanged = entry?.model !== undefined && entry.model !== resolved.model;
      const storedEffortChanged =
        entry?.effort !== undefined && entry.effort !== (resolved.effort ?? undefined);
      if (conversationId || runtime.pool.has(poolKey)) {
        if (
          modelChanged ||
          storedModelChanged ||
          storedEffortChanged ||
          isLastAssistantForeign(context.messages)
        ) {
          conversationId = null;
          wasReset = true;
          await resetSessionState(
            {
              disposeKey: (k) => runtime.pool.disposeKey(k),
              set: (k, c, p) => runtime.store.set(k, c, p),
            },
            poolKey,
          );
        }
      }
      remainingTimeout();

      const before = conversationId ? null : await snapshot(runtime.config.conversationsDir);
      remainingTimeout();

      const latest = mapPrompt(context.messages);
      const seed = consumeCompactSeed(poolKey);
      let prompt: string;
      let historyFile: string | null = null;
      if (!conversationId) {
        const segment = buildFullHistorySegment(context.messages, seed);
        if (segment) {
          const byteLength = Buffer.byteLength(segment, "utf8");
          const inputThreshold = Number(process.env.AGY_INPUT_HISTORY_THRESHOLD ?? 50 * 1024);
          if (byteLength > inputThreshold) {
            const previewChars = Number(process.env.AGY_INPUT_HISTORY_PREVIEW ?? 2000);
            const fileName = `pi-agy-history-${poolKey.replace(/[^a-zA-Z0-9_-]/g, "_")}-${Date.now()}.md`;
            historyFile = join(cwd, ".temp", fileName);
            await mkdir(join(cwd, ".temp"), { recursive: true });
            await writeFile(historyFile, segment, "utf8");
            prompt = assembleHistoryPrompt(
              buildFileDirective(`.temp/${fileName}`, byteLength, segment.slice(0, previewChars)),
              latest,
            );
          } else {
            prompt = assembleHistoryPrompt(segment, latest);
          }
        } else {
          prompt = latest;
        }
      } else {
        prompt = latest;
      }
      if (seed) prompt = withCompactSummaryPrefix(prompt, seed);
      remainingTimeout();
      if (!prompt.trim()) throw new Error("agy turn has no user text");

      let streamed = false;
      let textStarted = false;
      let textIndex: number | null = null;
      const pushText = (text: string) => {
        if (!text) return;
        if (!textStarted) {
          textIndex = output.content.length;
          output.content.push({ type: "text", text: "" });
          stream.push({
            type: "text_start",
            contentIndex: textIndex,
            partial: output,
          });
          textStarted = true;
        }
        if (textIndex === null) return;
        const block = output.content[textIndex];
        if (block?.type === "text") {
          block.text += text;
          stream.push({
            type: "text_delta",
            contentIndex: textIndex,
            delta: text,
            partial: output,
          });
        }
      };

      const handle = runtime.pool.acquire(
        rawSessionId,
        cwd,
        resolved.model,
        resolved.effort,
        conversationId ?? undefined,
      );

      let result: RunPooledResult;
      try {
        result = await handle.prompt(prompt, {
          signal: options?.signal,
          timeoutMs: remainingTimeout(),
          onEvent: (event) => {
            if (event.type === "conversation" && !conversationId) conversationId = event.id;
            if (event.type === "text" && event.text) {
              streamed = true;
              pushText(event.text);
            }
            if (event.type === "tool_end" && event.output) {
              const out = event.output;
              const alias: Record<string, string> = {
                grep_search: "rg",
                list_dir: "ls",
                view_file: "read",
              };
              const displayName = alias[event.name] ?? event.name;
              pushText(`\n[${displayName}] output:\n${out}\n`);
            }
          },
        });
      } finally {
        if (historyFile) await unlink(historyFile).catch(() => undefined);
      }

      if (!conversationId && result.conversationId) conversationId = result.conversationId;
      if (!conversationId && before)
        conversationId = await findNewConversation(before, runtime.config.conversationsDir);

      let prevOutput = prevOutputs.get(poolKey) ?? "";
      if (!prevOutput && entry?.prevOutput && !wasReset) {
        prevOutput = entry.prevOutput;
        prevOutputs.set(poolKey, prevOutput);
      }
      const delta = extractDelta(prevOutput, result.stdout, !!conversationId);
      if (!streamed && delta) pushText(delta);

      const fileThreshold = Number(process.env.AGY_OUTPUT_FILE_THRESHOLD ?? 50 * 1024);
      if (textStarted && textIndex !== null) {
        const block = output.content[textIndex];
        if (block?.type === "text" && Buffer.byteLength(block.text, "utf8") > fileThreshold) {
          const outDir = join(homedir(), ".pi", "agent", "agy", "outputs");
          await mkdir(outDir, { recursive: true });
          const outPath = join(
            outDir,
            `${poolKey.replace(/[^a-zA-Z0-9_-]/g, "_")}-${Date.now()}.md`,
          );
          const fullText = block.text;
          await writeFile(outPath, fullText, "utf8");
          void (async () => {
            try {
              const files = await readdir(outDir);
              const entries = await Promise.all(
                files.map(async (f) => {
                  const p = join(outDir, f);
                  try {
                    const s = await stat(p);
                    return { path: p, mtime: s.mtimeMs };
                  } catch {
                    return null;
                  }
                }),
              );
              const valid = entries
                .filter((e): e is { path: string; mtime: number } => !!e)
                .toSorted((a, b) => b.mtime - a.mtime);
              const maxFiles = Number(process.env.AGY_OUTPUT_MAX_FILES ?? 1000);
              const maxAgeMs = Number(
                process.env.AGY_OUTPUT_MAX_AGE_MS ?? 365 * 24 * 60 * 60 * 1000,
              );
              const now = Date.now();
              for (let i = 0; i < valid.length; i++) {
                const e = valid[i];
                if (i >= maxFiles || now - e.mtime > maxAgeMs) {
                  try {
                    await unlink(e.path);
                  } catch {}
                }
              }
            } catch {}
          })();
          const preview = fullText.slice(0, 2000);
          block.text = `Output too large (${Buffer.byteLength(fullText, "utf8")} bytes), saved to file://${outPath}\n\nPreview (first 2000 chars):\n${preview}\n...[full output in file]`;
        }
        if (block?.type === "text") {
          stream.push({
            type: "text_end",
            contentIndex: textIndex,
            content: block.text,
            partial: output,
          });
        }
      }

      if (conversationId) prevOutputs.set(poolKey, result.stdout);
      else prevOutputs.delete(poolKey);

      await runtime.store.set(
        poolKey,
        conversationId,
        conversationId ? result.stdout : "",
        resolved.model,
        resolved.effort,
      );

      if (result.usage) {
        output.usage.input = result.usage.inputTokens;
        output.usage.output = result.usage.outputTokens;
        output.usage.totalTokens = result.usage.totalTokens;
        calculateCost(model, output.usage);
      }
      output.stopReason = "stop";
      stream.push({ type: "done", reason: "stop", message: output });
      stream.end();
    } catch (error) {
      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      output.errorMessage = error instanceof Error ? error.message : String(error);
      stream.push({ type: "error", reason: output.stopReason, error: output });
      stream.end();
    } finally {
      if (releaseBindingLock) await releaseBindingLock();
    }
  })();
  return stream;
}

export default async function (pi: ExtensionAPI) {
  const config = loadConfig();
  let cwd = process.cwd();
  const { models, meta } = await discoverModels();

  const pool = new AgyPool({
    binary: config.binary,
    extraArgs: config.extraArgs,
    timeoutMs: config.timeoutMs,
    idleTimeoutMs: Number(process.env.AGY_POOL_IDLE_MS ?? 5 * 60 * 1000),
    maxEntries: Number(process.env.AGY_POOL_MAX_SIZE ?? 20),
  });

  const runtime: PoolRuntime = {
    config,
    getCwd: () => cwd,
    getMeta: (modelId) => meta.get(modelId),
    store: new SessionStore(config.stateFile, config.bindingLockFile),
    pool,
  };

  const poolModels = toPoolModels(models);

  const stream = (
    model: Model<"openai-completions">,
    context: Context,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream => streamAgyPool(runtime, model, context, options);

  pi.registerProvider(
    createProvider({
      id: "antigravity",
      name: "Antigravity",
      baseUrl: "pi-agent-bridge://antigravity",
      auth: {
        apiKey: {
          name: "Antigravity CLI",
          resolve: async () => ({
            auth: { apiKey: "antigravity" },
            source: "Antigravity CLI",
          }),
        },
      },
      models: poolModels,
      api: { stream, streamSimple: stream },
    }),
  );

  pi.on("session_start", (_event, ctx) => {
    cwd = ctx.cwd;
  });

  pi.on("session_compact", async (event, ctx) => {
    // pi history is now summary-only: drop the agy-side conversation so the
    // next turn starts fresh, seeded with pi's summary.
    try {
      const key = compositeKey(ctx.sessionManager.getSessionId(), ctx.cwd);
      await resetPoolForCompaction(
        {
          disposeKey: (k) => pool.disposeKey(k),
          set: (k, c, p) => runtime.store.set(k, c, p),
        },
        key,
        event.compactionEntry.summary,
      );
    } catch {
      // compaction already succeeded; bridge reset is best-effort only
    }
  });
}
