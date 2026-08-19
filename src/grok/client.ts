import { spawn, type ChildProcess } from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import type { GrokConfig } from "./config.ts";

export interface GrokTurnInput {
  sessionId?: string;
  cwd: string;
  model: string;
  /** Sent as session/set_mode modeId (low|medium|high|xhigh). */
  effort: string;
  prompt: string;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
  onText?: (text: string) => void;
}

export interface GrokTurnResult {
  sessionId: string;
  text: string;
  stopReason: string;
}

type SessionUpdate = {
  sessionUpdate: string;
  content?: { type?: string; text?: string };
  [key: string]: unknown;
};
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
 * Long-lived client over `grok agent --always-approve stdio`.
 * One process, many ACP sessions (keyed externally by Pi session id).
 *
 * Grok ACP differences vs codex-acp:
 * - model: extension method `session/set_model` { modelId }
 * - effort: `session/set_mode` with modeId = low|medium|high|xhigh
 * - no session/set_config_option
 */
export class GrokAcpClient {
  private readonly config: GrokConfig;
  private child: ChildProcess | null = null;
  private connection: acp.ClientConnection | null = null;
  private ctx: acp.ClientContext | null = null;
  private startPromise: Promise<void> | null = null;
  private readonly listeners = new Map<string, SessionListener>();
  private readonly applied = new Map<string, { model: string; effort: string }>();

  constructor(config: GrokConfig) {
    this.config = config;
  }

  async runTurn(input: GrokTurnInput): Promise<GrokTurnResult> {
    if (input.abortSignal?.aborted) {
      throw createAbortError(input.abortSignal.reason);
    }
    await this.ensureStarted();
    const ctx = this.ctx!;
    const timeoutMs = input.timeoutMs ?? this.config.timeoutMs;

    let sessionId = input.sessionId;
    if (!sessionId) {
      const created = await ctx.request(acp.methods.agent.session.new, {
        cwd: input.cwd,
        mcpServers: [],
      });
      sessionId = created.sessionId;
    } else if (!this.applied.has(sessionId)) {
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

    await this.applySessionConfig(sessionId, input.model, input.effort);

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
        { cancellationSignal: combined },
      );

      if (timeoutController.signal.aborted && !input.abortSignal?.aborted) {
        throw new Error("grok-acp timed out");
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
  ): Promise<void> {
    const ctx = this.ctx!;
    const prev = this.applied.get(sessionId);

    if (!prev || prev.model !== model) {
      await ctx.request("session/set_model", {
        sessionId,
        modelId: model,
      });
    }
    // Grok maps reasoning effort onto session modes (low|medium|high|xhigh).
    if (!prev || prev.effort !== effort) {
      await ctx.request(acp.methods.agent.session.setMode, {
        sessionId,
        modeId: effort,
      });
    }
    this.applied.set(sessionId, { model, effort });
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
      throw new Error("failed to spawn grok-acp: missing stdio pipes");
    }

    const stream = acp.ndJsonStream(
      Writable.toWeb(child.stdin),
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    );

    const connection = acp
      .client({ name: "pi-agent-bridge-grok" })
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
        clientInfo: { name: "pi-agent-bridge-grok", version: "0.1.0" },
      });
    } catch (error) {
      const detail = stderr.trim();
      await this.dispose();
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(
        detail ? `grok-acp initialize failed: ${msg}\n${detail}` : `grok-acp initialize failed: ${msg}`,
      );
    }

    if (child.exitCode !== null) {
      throw new Error(
        `grok-acp exited during startup (code ${child.exitCode})${stderr.trim() ? `: ${stderr.trim()}` : ""}`,
      );
    }
  }
}
