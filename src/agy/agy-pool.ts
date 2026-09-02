/**
 * Long-lived agy pool — maintains one agy child per composite session key.
 *
 * Spawn contract: agy --input-format stream-json --output-format stream-json
 * Stdin:   one NDJSON line per turn: {event:"user", message:{content: prompt}}
 * Stdout:  NDJSON stream (init / step_update / result) shared across turns.
 * Turns are serialized per process (queue); result event delimits a turn.
 *
 * Keys by compositeKey = (sessionId||"default") + "::" + hash(cwd)
 * ponytail: idle eviction is naive setTimeout per entry; global LRU is O(n) scan.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { createHash } from "node:crypto";

export interface AgyPoolOptions {
  binary?: string;
  extraArgs?: string[];
  timeoutMs?: number;
  idleTimeoutMs?: number;
  maxEntries?: number;
}

export interface PoolPromptOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  onEvent?: (event: AgyStreamEvent) => void;
}

export interface RunPooledResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  conversationId?: string;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
}

export type AgyStreamEvent =
  | { type: "text"; text: string }
  | { type: "conversation"; id: string }
  | {
      type: "tool_start";
      id: string;
      name: string;
      args: Record<string, unknown>;
    }
  | {
      type: "tool_end";
      id: string;
      name: string;
      args: Record<string, unknown>;
      output?: string;
    };

/** Short hash cwd to avoid huge keys and collisions across workspaces. */
export function hashCwd(cwd: string): string {
  return createHash("sha256").update(cwd).digest("hex").slice(0, 16);
}

export function compositeKey(sessionId: string | undefined, cwd: string): string {
  const sid = sessionId?.trim() || "default";
  return `${sid}::${hashCwd(cwd)}`;
}

/** Whether a raw sessionKey already looks like a composite key. */
export function isCompositeKey(key: string): boolean {
  // composite is sid::hex16 — must end with :: + 16 hex chars
  return /^.+::[0-9a-f]{16}$/.test(key);
}

export function createAbortError(reason?: unknown): Error {
  if (reason instanceof Error) {
    if (reason.name === "AbortError") return reason;
    const err = new Error(reason.message);
    err.name = "AbortError";
    err.stack = reason.stack;
    return err;
  }
  const message = typeof reason === "string" ? reason : "The operation was aborted";
  const err = new Error(message);
  err.name = "AbortError";
  return err;
}

export function parseAgyLine(rawLine: string): Record<string, unknown> | null {
  const line = rawLine.trim();
  if (!line.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    if (typeof parsed.event !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function handleAgentResponse(pending: any, stepType: string | undefined, textDelta: string | undefined, state: string | undefined, status: string | undefined): void {
  if (stepType !== "agent_response" || typeof textDelta !== "string" || !pending) return;
  if (state === "ACTIVE" || state === "DONE") {
    pending.accumulatedText += textDelta;
    pending.onEvent?.({ type: "text", text: textDelta });
    return;
  }
  if (status === "DONE") {
    if (textDelta.startsWith(pending.accumulatedText)) {
      const suffix = textDelta.slice(pending.accumulatedText.length);
      if (suffix) {
        pending.accumulatedText = textDelta;
        pending.onEvent?.({ type: "text", text: suffix });
      }
    } else if (!pending.streamError) {
      pending.streamError = new Error("Inconsistent stream: DONE snapshot does not match accumulated text");
    }
    return;
  }
  if (textDelta) {
    pending.accumulatedText += textDelta;
    pending.onEvent?.({ type: "text", text: textDelta });
  }
}

interface PendingTurn {
  accumulatedText: string;
  resultResponse?: string;
  resultStatus?: string;
  resultError?: string;
  conversationId?: string;
  usage?: RunPooledResult["usage"];
  sawValidEvent: boolean;
  streamError?: Error;
  resolve: (r: RunPooledResult) => void;
  reject: (e: Error) => void;
  onEvent?: (event: AgyStreamEvent) => void;
  timeoutTimer?: ReturnType<typeof setTimeout>;
  onAbort?: () => void;
}

interface PoolEntry {
  key: string;
  cwd: string;
  model?: string;
  effort?: string;
  conversationId?: string;
  child: ChildProcess;
  stdoutBuffer: string;
  decoder: StringDecoder;
  stderrChunks: Buffer[];
  pending: PendingTurn | null;
  queue: Promise<void>;
  lastUsed: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
  closed: boolean;
}

export class AgyPool {
  private entries = new Map<string, PoolEntry>();
  private readonly binary: string;
  private readonly extraArgs: string[];
  private readonly defaultTimeoutMs: number;
  private readonly idleTimeoutMs: number;
  private readonly maxEntries: number;

  constructor(opts: AgyPoolOptions = {}) {
    this.binary = opts.binary ?? "agy";
    this.extraArgs = opts.extraArgs ?? [];
    this.defaultTimeoutMs = opts.timeoutMs ?? 300_000;
    this.idleTimeoutMs = opts.idleTimeoutMs ?? 5 * 60 * 1000;
    this.maxEntries = opts.maxEntries ?? 20;
  }

  /**
   * Acquire a handle for a session.
   * Accepts either raw sessionId (will be hashed with cwd) or already-composite key.
   * If sessionKey contains "::", it is treated as composite directly (with cwd mismatch check).
   * Otherwise composite is computed from sessionKey as sessionId + cwd.
   */
  acquire(
    sessionKey: string | undefined,
    cwd: string,
    model?: string,
    effort?: string,
    conversationId?: string,
  ): PooledHandle {
    const raw = sessionKey?.trim() || "default";
    const key = isCompositeKey(raw) ? raw : compositeKey(raw, cwd);
    const entry = this.ensureEntry(key, cwd, model, effort, conversationId);
    return new PooledHandle(this, entry);
  }

  /** Alias that explicitly treats first arg as raw sessionId */
  acquireForSession(
    sessionId: string | undefined,
    cwd: string,
    model?: string,
    effort?: string,
    conversationId?: string,
  ): PooledHandle {
    const key = compositeKey(sessionId, cwd);
    const entry = this.ensureEntry(key, cwd, model, effort, conversationId);
    return new PooledHandle(this, entry);
  }

  /** Direct by composite key */
  acquireByKey(
    composite: string,
    cwd: string,
    model?: string,
    effort?: string,
    conversationId?: string,
  ): PooledHandle {
    const entry = this.ensureEntry(composite, cwd, model, effort, conversationId);
    return new PooledHandle(this, entry);
  }

  disposeAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const e of this.entries.values()) promises.push(this.disposeEntry(e));
    return Promise.all(promises).then(() => {
      this.entries.clear();
    });
  }

  size(): number {
    return this.entries.size;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  // -- internal --

  private ensureEntry(
    key: string,
    cwd: string,
    model?: string,
    effort?: string,
    conversationId?: string,
  ): PoolEntry {
    const existing = this.entries.get(key);
    if (existing && !existing.closed) {
      const cwdMismatch = existing.cwd !== cwd;
      const modelMismatch = (existing.model ?? undefined) !== (model ?? undefined);
      const effortMismatch = (existing.effort ?? undefined) !== (effort ?? undefined);
      if (cwdMismatch || modelMismatch || effortMismatch) {
        // fire-and-forget dispose old entry; next turn will use new one
        void this.disposeEntry(existing);
        this.entries.delete(key);
      } else {
        // refresh idle timer
        this.resetIdleTimer(existing);
        // update conversationId if newly discovered and entry lacks one
        if (conversationId && !existing.conversationId) existing.conversationId = conversationId;
        // also if entry has conversationId but caller passes different, keep entry's (pool owns truth)
        this.enforceMaxEntries();
        return existing;
      }
    } else if (existing?.closed) {
      this.entries.delete(key);
    }

    const entry = this.spawnEntry(key, cwd, model, effort, conversationId);
    this.entries.set(key, entry);
    this.enforceMaxEntries();
    return entry;
  }

  private spawnEntry(
    key: string,
    cwd: string,
    model?: string,
    effort?: string,
    conversationId?: string,
  ): PoolEntry {
    const args: string[] = ["--add-dir", cwd, "--dangerously-skip-permissions", ...this.extraArgs];
    if (model) args.push("--model", model);
    if (effort?.trim()) args.push("--effort", effort);
    if (conversationId) args.push("--conversation", conversationId);
    args.push("--input-format", "stream-json", "--output-format", "stream-json");

    const child = spawn(this.binary, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const entry: PoolEntry = {
      key,
      cwd,
      model,
      effort,
      conversationId,
      child,
      stdoutBuffer: "",
      decoder: new StringDecoder("utf-8"),
      stderrChunks: [],
      pending: null,
      queue: Promise.resolve(),
      lastUsed: Date.now(),
      idleTimer: null,
      closed: false,
    };

    child.stdout?.on("data", (chunk: Buffer) => this.onStdout(entry, chunk));
    child.stderr?.on("data", (chunk: Buffer) => {
      entry.stderrChunks.push(chunk);
    });
    child.on("error", (err) =>
      this.onCrash(entry, new Error(`failed to spawn agy: ${err.message}`)),
    );
    child.on("close", (code, signal) => {
      if (entry.closed) return;
      // if pending, reject; otherwise just remove
      if (entry.pending) {
        const msg = signal
          ? `agy pool process killed by ${signal}`
          : `agy pool process exited ${code ?? "unknown"}`;
        const err = new Error(msg);
        // late-fail tolerance not needed here; pool level crash is retryable
        entry.pending.reject(err);
        entry.pending = null;
      }
      entry.closed = true;
      if (entry.idleTimer) {
        clearTimeout(entry.idleTimer);
        entry.idleTimer = null;
      }
      this.entries.delete(key);
    });

    this.resetIdleTimer(entry);
    return entry;
  }

  private onStdout(entry: PoolEntry, chunk: Buffer) {
    entry.stdoutBuffer += entry.decoder.write(chunk);
    const lines = entry.stdoutBuffer.split("\n");
    entry.stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) this.handleLine(entry, line);
  }

  private handleLine(entry: PoolEntry, rawLine: string) {
    const parsed = parseAgyLine(rawLine);
    if (!parsed) return;

    const pending = entry.pending;

    // Always capture conversation_id for entry-level tracking
    const topConv = typeof parsed.conversation_id === "string" ? parsed.conversation_id : undefined;
    if (topConv) entry.conversationId = topConv;

    if (parsed.event === "init" && typeof parsed.conversation_id === "string") {
      entry.conversationId = parsed.conversation_id;
      if (pending) {
        pending.conversationId = parsed.conversation_id;
        pending.sawValidEvent = true;
        pending.onEvent?.({ type: "conversation", id: parsed.conversation_id });
      }
      return;
    }

    if (parsed.event === "step_update") {
      const step = (parsed.step_update ?? parsed) as Record<string, unknown>;
      const stepConv =
        (typeof step.conversation_id === "string" ? step.conversation_id : undefined) ??
        (typeof parsed.conversation_id === "string" ? parsed.conversation_id : undefined);
      if (stepConv) {
        entry.conversationId = stepConv;
        if (pending) pending.conversationId = stepConv;
        pending?.onEvent?.({ type: "conversation", id: stepConv });
      }
      if (pending) pending.sawValidEvent = true;

      const stepType =
        (typeof step.step_type === "string" ? step.step_type : undefined) ??
        (typeof parsed.step_type === "string" ? parsed.step_type : undefined);
      const textDelta =
        (typeof step.text_delta === "string" ? step.text_delta : undefined) ??
        (typeof parsed.text_delta === "string" ? parsed.text_delta : undefined);
      const state =
        (typeof step.state === "string" ? step.state : undefined) ??
        (typeof parsed.state === "string" ? parsed.state : undefined);
      const status =
        (typeof step.status === "string" ? step.status : undefined) ??
        (typeof parsed.status === "string" ? parsed.status : undefined);

      handleAgentResponse(pending, stepType, textDelta, state, status);

      if (stepType === "tool" && typeof step.tool_name === "string" && pending) {
        const toolName = step.tool_name as string;
        const toolInfo = (step.tool_info ?? {}) as Record<string, unknown>;
        const params = (toolInfo.parameters ?? {}) as Record<string, unknown>;
        const output = typeof toolInfo.output === "string" ? toolInfo.output : undefined;
        const stepIndex = typeof step.step_index === "number" ? step.step_index : Date.now();
        const toolId = `agy-tool-${stepIndex}-${toolName}`;
        if (state === "ACTIVE") {
          pending.onEvent?.({
            type: "tool_start",
            id: toolId,
            name: toolName,
            args: params,
          });
        } else if (state === "DONE") {
          pending.onEvent?.({
            type: "tool_end",
            id: toolId,
            name: toolName,
            args: params,
            output,
          });
        }
      }
      return;
    }

    if (parsed.event === "result" && pending) {
      pending.sawValidEvent = true;
      const result = (parsed.result ?? parsed) as Record<string, unknown>;
      // conversation id may be top-level or inside result
      if (typeof parsed.conversation_id === "string") {
        entry.conversationId = parsed.conversation_id;
        pending.conversationId = parsed.conversation_id;
        pending.onEvent?.({ type: "conversation", id: parsed.conversation_id });
      } else if (typeof result.conversation_id === "string") {
        entry.conversationId = result.conversation_id;
        pending.conversationId = result.conversation_id;
        pending.onEvent?.({ type: "conversation", id: result.conversation_id });
      }
      pending.resultStatus = typeof result.status === "string" ? result.status : undefined;
      pending.resultResponse = typeof result.response === "string" ? result.response : undefined;
      pending.resultError = typeof result.error === "string" ? result.error : undefined;
      const ru = result.usage as Record<string, unknown> | undefined;
      if (
        ru &&
        typeof ru.input_tokens === "number" &&
        typeof ru.output_tokens === "number" &&
        typeof ru.total_tokens === "number"
      ) {
        pending.usage = {
          inputTokens: ru.input_tokens,
          outputTokens: ru.output_tokens,
          totalTokens: ru.total_tokens,
        };
      }
      // settle this turn
      this.settlePending(entry);
    }
  }

  private settlePending(entry: PoolEntry) {
    const pending = entry.pending;
    if (!pending) return;
    entry.pending = null;
    if (pending.timeoutTimer) clearTimeout(pending.timeoutTimer);
    // abort listener cleanup handled in _exec wrapper (pending.resolve/reject)
    entry.lastUsed = Date.now();
    this.resetIdleTimer(entry);

    const stderr = Buffer.concat(entry.stderrChunks).toString("utf-8");
    // clear stderr for next turn? keep accumulated but slice; easier to reset
    entry.stderrChunks = [];

    if (pending.streamError) {
      pending.reject(pending.streamError);
      return;
    }

    const finalText =
      pending.accumulatedText || pending.resultResponse || (!pending.sawValidEvent ? "" : "");
    const hasAnswer = Boolean(pending.accumulatedText || pending.resultResponse);

    if (!hasAnswer) {
      if (pending.resultStatus && pending.resultStatus !== "SUCCESS") {
        pending.reject(
          new Error(
            pending.resultError?.trim() || `agy failed with status ${pending.resultStatus}`,
          ),
        );
        return;
      }
      // if no answer and no status, treat as error if stderr present
      if (stderr.trim()) {
        pending.reject(new Error(pending.resultError?.trim() || stderr.trim()));
        return;
      }
    }

    pending.resolve({
      stdout: finalText,
      stderr,
      exitCode: 0,
      ...(pending.conversationId || entry.conversationId
        ? { conversationId: pending.conversationId ?? entry.conversationId }
        : {}),
      ...(pending.usage ? { usage: pending.usage } : {}),
    });
  }

  private onCrash(entry: PoolEntry, error: Error) {
    if (entry.pending) {
      if (entry.pending.timeoutTimer) clearTimeout(entry.pending.timeoutTimer);
      entry.pending.reject(error);
      entry.pending = null;
    }
    entry.closed = true;
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }
    this.entries.delete(entry.key);
    try {
      entry.child.kill("SIGTERM");
    } catch {}
  }

  private resetIdleTimer(entry: PoolEntry) {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    if (this.idleTimeoutMs <= 0) return;
    entry.idleTimer = setTimeout(() => {
      void this.disposeEntry(entry);
      this.entries.delete(entry.key);
    }, this.idleTimeoutMs);
    entry.idleTimer.unref?.();
  }

  private enforceMaxEntries() {
    if (this.entries.size <= this.maxEntries) return;
    // evict LRU
    const sorted = [...this.entries.values()].sort((a, b) => a.lastUsed - b.lastUsed);
    const toEvict = sorted.slice(0, this.entries.size - this.maxEntries);
    for (const e of toEvict) {
      void this.disposeEntry(e);
      this.entries.delete(e.key);
    }
  }

  private async disposeEntry(entry: PoolEntry): Promise<void> {
    entry.closed = true;
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }
    if (entry.pending) {
      entry.pending.reject(new Error("agy pool entry disposed"));
      if (entry.pending.timeoutTimer) clearTimeout(entry.pending.timeoutTimer);
      entry.pending = null;
    }
    try {
      entry.child.stdin?.end();
    } catch {}
    // give graceful close 2s then SIGKILL
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      entry.child.once("close", finish);
      setTimeout(() => {
        if (entry.child.exitCode === null && entry.child.signalCode === null) {
          try {
            entry.child.kill("SIGTERM");
          } catch {}
          setTimeout(() => {
            if (entry.child.exitCode === null && entry.child.signalCode === null) {
              try {
                entry.child.kill("SIGKILL");
              } catch {}
            }
            finish();
          }, 1000).unref?.();
        } else finish();
      }, 2000).unref?.();
      // if no child, resolve quickly
      if (entry.child.exitCode !== null || entry.child.signalCode !== null) finish();
    });
  }

  // Called by handle to execute a prompt
  _exec(entry: PoolEntry, prompt: string, opts: PoolPromptOptions = {}): Promise<RunPooledResult> {
    const timeoutMs = opts.timeoutMs ?? this.defaultTimeoutMs;

    // chain onto queue to serialize
    const task: Promise<RunPooledResult> = entry.queue.then(() =>
      this.doExec(entry, prompt, opts, timeoutMs),
    );
    // keep queue alive even if task rejects
    entry.queue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  private doExec(
    entry: PoolEntry,
    prompt: string,
    opts: PoolPromptOptions,
    timeoutMs: number,
  ): Promise<RunPooledResult> {
    if (entry.closed) return Promise.reject(new Error("agy pool entry closed"));
    if (opts.signal?.aborted) return Promise.reject(createAbortError(opts.signal.reason));
    if (entry.child.exitCode !== null || entry.child.signalCode !== null) {
      this.entries.delete(entry.key);
      return Promise.reject(new Error("agy pool process exited"));
    }
    if (!entry.child.stdin?.writable) {
      this.entries.delete(entry.key);
      return Promise.reject(new Error("agy pool stdin not writable"));
    }

    return new Promise<RunPooledResult>((resolve, reject) => {
      const pending: PendingTurn = {
        accumulatedText: "",
        sawValidEvent: false,
        resolve,
        reject,
        onEvent: opts.onEvent,
      };
      entry.pending = pending;

      let settled = false;
      const settleReject = (err: Error) => {
        if (settled) return;
        settled = true;
        entry.pending = null;
        if (pending.timeoutTimer) clearTimeout(pending.timeoutTimer);
        if (opts.signal && onAbort) opts.signal.removeEventListener("abort", onAbort);
        // on timeout/abort, dispose entry so next turn respawns
        if (err.name === "AbortError" || err.message.includes("timed out")) {
          void this.disposeEntry(entry);
          this.entries.delete(entry.key);
        }
        reject(err);
      };
      const onAbort = () => {
        try {
          entry.child.kill("SIGTERM");
        } catch {}
        settleReject(createAbortError(opts.signal?.reason));
      };

      pending.timeoutTimer = setTimeout(() => {
        settleReject(new Error("agy timed out"));
        try {
          entry.child.kill("SIGTERM");
        } catch {}
      }, timeoutMs);
      pending.timeoutTimer.unref?.();

      if (opts.signal) opts.signal.addEventListener("abort", onAbort, { once: true });

      // wrap original resolve/reject to cleanup abort/timeout
      const origResolve = pending.resolve;
      const origReject = pending.reject;
      pending.resolve = (v) => {
        if (settled) return;
        settled = true;
        if (pending.timeoutTimer) clearTimeout(pending.timeoutTimer);
        if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
        origResolve(v);
      };
      pending.reject = (e) => {
        if (settled) return;
        settled = true;
        if (pending.timeoutTimer) clearTimeout(pending.timeoutTimer);
        if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
        origReject(e);
      };

      // write prompt
      try {
        const line = JSON.stringify({ event: "user", message: { content: prompt } }) + "\n";
        const ok = entry.child.stdin!.write(line, (err) => {
          if (err) settleReject(new Error(`failed to write to agy pool: ${err.message}`));
        });
        if (!ok) {
          // ponytail: backpressure — large prompt fills kernel buffer; drain will unblock next queued turn
          entry.child.stdin!.once("drain", () => {});
        }
      } catch (e) {
        settleReject(new Error(`failed to write to agy pool: ${String(e)}`));
      }
    });
  }

  _disposeHandle(entry: PoolEntry): Promise<void> {
    return this.disposeEntry(entry).then(() => {
      this.entries.delete(entry.key);
    });
  }
}

export class PooledHandle {
  private pool: AgyPool;
  private entry: PoolEntry;
  constructor(pool: AgyPool, entry: PoolEntry) {
    this.pool = pool;
    this.entry = entry;
  }

  get key(): string {
    return this.entry.key;
  }
  get cwd(): string {
    return this.entry.cwd;
  }
  get conversationId(): string | undefined {
    return this.entry.conversationId;
  }

  prompt(prompt: string, opts?: PoolPromptOptions): Promise<RunPooledResult> {
    return this.pool._exec(this.entry, prompt, opts);
  }

  dispose(): Promise<void> {
    return this.pool._disposeHandle(this.entry);
  }
}
