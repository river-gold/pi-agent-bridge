import { spawn, type ChildProcess } from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import type { CodexConfig } from "./config.ts";

export interface CodexTurnInput {
  /** Bound ACP session id, if already known. */
  sessionId?: string;
  cwd: string;
  model: string;
  /** Always sent as reasoning_effort (none removed). */
  effort: string;
  prompt: string;
  mode?: string;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
  onText?: (text: string) => void;
}

export interface CodexTurnResult {
  sessionId: string;
  text: string;
  stopReason: string;
}

type SessionUpdate = { sessionUpdate: string; content?: { type?: string; text?: string }; [key: string]: unknown };
type SessionListener = (update: SessionUpdate) => void;

function createAbortError(reason?: unknown): Error {
  if (reason instanceof Error) {
    if (reason.name === "AbortError") return reason;
    const err = new Error(reason.message);
    err.name = "AbortError";
    err.stack = reason.stack;
    return err;
  }
  if (typeof DOMException !== "undefined") {
    return new DOMException(
      typeof reason === "string" ? reason : "The operation was aborted",
      "AbortError",
    );
  }
  const err = new Error(typeof reason === "string" ? reason : "The operation was aborted");
  err.name = "AbortError";
  return err;
}

function pickPermissionOption(
  options: Array<{ optionId: string; kind: string }>,
): string {
  const prefer = ["allow_always", "allow_once", "proceed_always", "proceed_once"];
  for (const kind of prefer) {
    const hit = options.find((o) => o.kind === kind);
    if (hit) return hit.optionId;
  }
  return options[0]?.optionId ?? "allow";
}

/**
 * Long-lived client over `npx @agentclientprotocol/codex-acp`.
 * One process, many ACP sessions (keyed externally by Pi session id).
 */
export class CodexAcpClient {
  private readonly config: CodexConfig;
  private child: ChildProcess | null = null;
  private connection: acp.ClientConnection | null = null;
  private ctx: acp.ClientContext | null = null;
  private startPromise: Promise<void> | null = null;
  private readonly listeners = new Map<string, SessionListener>();
  /** Last applied model/effort per ACP session. */
  private readonly applied = new Map<string, { model: string; effort: string; mode: string }>();

  constructor(config: CodexConfig) {
    this.config = config;
  }

  async runTurn(input: CodexTurnInput): Promise<CodexTurnResult> {
    if (input.abortSignal?.aborted) {
      throw createAbortError(input.abortSignal.reason);
    }
    await this.ensureStarted();
    const ctx = this.ctx!;
    const mode = input.mode ?? this.config.mode;
    const timeoutMs = input.timeoutMs ?? this.config.timeoutMs;

    let sessionId = input.sessionId;
    if (!sessionId) {
      const created = await ctx.request(acp.methods.agent.session.new, {
        cwd: input.cwd,
        mcpServers: [],
      });
      sessionId = created.sessionId;
    } else if (!this.applied.has(sessionId)) {
      // Process may have restarted; try resume before falling back to new.
      try {
        await ctx.request(acp.methods.agent.session.resume, {
          sessionId,
          cwd: input.cwd,
          mcpServers: [],
        });
      } catch {
        const created = await ctx.request(acp.methods.agent.session.new, {
          cwd: input.cwd,
          mcpServers: [],
        });
        sessionId = created.sessionId;
      }
    }

    await this.applySessionConfig(sessionId, input.model, input.effort, mode);

    let accumulated = "";
    this.listeners.set(sessionId, (update) => {
      if (
        update.sessionUpdate === "agent_message_chunk" &&
        update.content &&
        typeof update.content === "object" &&
        "type" in update.content &&
        update.content.type === "text" &&
        typeof update.content.text === "string"
      ) {
        accumulated += update.content.text;
        input.onText?.(update.content.text);
      }
    });

    const abortTurn = () => {
      void ctx.notify(acp.methods.agent.session.cancel, { sessionId: sessionId! }).catch(() => {});
    };

    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    const timeoutController = new AbortController();
    const onAbort = () => {
      timeoutController.abort();
      abortTurn();
    };

    if (input.abortSignal) {
      input.abortSignal.addEventListener("abort", onAbort, { once: true });
    }
    timeoutTimer = setTimeout(() => {
      timeoutController.abort();
      abortTurn();
    }, timeoutMs);

    try {
      if (timeoutController.signal.aborted || input.abortSignal?.aborted) {
        throw createAbortError(input.abortSignal?.reason);
      }

      const combined = AbortSignal.any
        ? AbortSignal.any(
            [timeoutController.signal, input.abortSignal].filter(Boolean) as AbortSignal[],
          )
        : timeoutController.signal;

      const response = await ctx.request(
        acp.methods.agent.session.prompt,
        {
          sessionId,
          prompt: [{ type: "text", text: input.prompt }],
        },
        { signal: combined },
      );

      if (timeoutController.signal.aborted && !input.abortSignal?.aborted) {
        throw new Error("codex-acp timed out");
      }
      if (input.abortSignal?.aborted) {
        throw createAbortError(input.abortSignal.reason);
      }

      return {
        sessionId,
        text: accumulated,
        stopReason: response.stopReason,
      };
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      input.abortSignal?.removeEventListener("abort", onAbort);
      this.listeners.delete(sessionId);
    }
  }

  async dispose(): Promise<void> {
    this.listeners.clear();
    this.applied.clear();
    try {
      this.connection?.close?.();
    } catch {
      // ignore
    }
    this.connection = null;
    this.ctx = null;
    this.startPromise = null;
    if (this.child && this.child.exitCode === null && this.child.signalCode === null) {
      try {
        this.child.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
    this.child = null;
  }

  private async applySessionConfig(
    sessionId: string,
    model: string,
    effort: string,
    mode: string,
  ): Promise<void> {
    const ctx = this.ctx!;
    const prev = this.applied.get(sessionId);
    if (!prev || prev.mode !== mode) {
      await ctx.request(acp.methods.agent.session.setMode, {
        sessionId,
        modeId: mode,
      });
    }
    if (!prev || prev.model !== model) {
      await ctx.request(acp.methods.agent.session.setConfigOption, {
        sessionId,
        configId: "model",
        value: model,
      });
    }
    if (!prev || prev.effort !== effort) {
      await ctx.request(acp.methods.agent.session.setConfigOption, {
        sessionId,
        configId: "reasoning_effort",
        value: effort,
      });
    }
    this.applied.set(sessionId, { model, effort, mode });
  }

  private ensureStarted(): Promise<void> {
    if (this.ctx) return Promise.resolve();
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.start().catch((err) => {
      this.startPromise = null;
      throw err;
    });
    return this.startPromise;
  }

  private async start(): Promise<void> {
    const child = spawn(this.config.command, this.config.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    this.child = child;

    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 16_000) stderr = stderr.slice(-16_000);
    });

    child.on("exit", () => {
      this.ctx = null;
      this.connection = null;
      this.startPromise = null;
      this.applied.clear();
      this.listeners.clear();
    });

    if (!child.stdin || !child.stdout) {
      throw new Error("failed to spawn codex-acp: missing stdio pipes");
    }

    const stream = acp.ndJsonStream(
      Writable.toWeb(child.stdin),
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    );

    const connection = acp
      .client({ name: "pi-agent-bridge-codex" })
      .onRequest(acp.methods.client.session.requestPermission, async (req) => {
        const optionId = pickPermissionOption(req.params.options);
        return {
          outcome: {
            outcome: "selected" as const,
            optionId,
          },
        };
      })
      .onNotification(acp.methods.client.session.update, async (req) => {
        const listener = this.listeners.get(req.params.sessionId);
        listener?.(req.params.update as SessionUpdate);
      })
      .connect(stream);

    this.connection = connection;
    this.ctx = connection.agent;

    try {
      await this.ctx.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
        },
        clientInfo: { name: "pi-agent-bridge-codex", version: "0.1.0" },
      });
    } catch (error) {
      const detail = stderr.trim();
      await this.dispose();
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(
        detail ? `codex-acp initialize failed: ${msg}\n${detail}` : `codex-acp initialize failed: ${msg}`,
      );
    }

    if (child.exitCode !== null) {
      throw new Error(
        `codex-acp exited during startup (code ${child.exitCode})${stderr.trim() ? `: ${stderr.trim()}` : ""}`,
      );
    }
  }
}
