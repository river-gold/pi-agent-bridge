import { spawn, type ChildProcess } from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import type { CursorConfig } from "./config.ts";
import { disposeChild } from "../shared/process.ts";

export interface CursorTurnInput {
  sessionId?: string;
  cwd: string;
  /** Full ACP model config value, e.g. default[] */
  model: string;
  mode?: string;
  prompt: string;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
  onText?: (text: string) => void;
}

export interface CursorTurnResult {
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

const passthroughParams = <T>(params: T): T => params;

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
  options: Array<{ optionId: string; kind?: string; name?: string }>,
): string {
  const score = (o: { optionId: string; kind?: string; name?: string }) => {
    const blob = `${o.optionId} ${o.kind ?? ""} ${o.name ?? ""}`.toLowerCase();
    if (blob.includes("allow-always") || blob.includes("allow_always")) return 0;
    if (blob.includes("allow-once") || blob.includes("allow_once")) return 1;
    if (blob.includes("allow") || blob.includes("proceed")) return 2;
    return 9;
  };
  const sorted = [...options].sort((a, b) => score(a) - score(b));
  return sorted[0]?.optionId ?? "allow-always";
}

/**
 * Long-lived client over `cursor-agent acp`.
 *
 * - auth: authenticate { methodId: "cursor_login" }
 * - model: session/set_config_option { configId: "model", value }
 * - mode: session/set_mode { modeId: agent|plan|ask }
 * - cursor/* extension methods auto-handled
 */
export class CursorAcpClient {
  private readonly config: CursorConfig;
  private child: ChildProcess | null = null;
  private connection: acp.ClientConnection | null = null;
  private ctx: acp.ClientContext | null = null;
  private startPromise: Promise<void> | null = null;
  private readonly listeners = new Map<string, SessionListener>();
  private readonly applied = new Map<string, { model: string; mode: string }>();
  private readonly texts = new Map<string, string>();

  constructor(config: CursorConfig) {
    this.config = config;
  }

  async runTurn(input: CursorTurnInput): Promise<CursorTurnResult> {
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
      // Cursor advertises loadSession; resume may be unavailable.
      try {
        await ctx.request(acp.methods.agent.session.load, {
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

    await this.applySessionConfig(sessionId, input.model, mode);

    this.texts.set(sessionId, "");
    this.listeners.set(sessionId, (update) => {
      if (
        update.sessionUpdate === "agent_message_chunk" &&
        update.content?.type === "text" &&
        typeof update.content.text === "string"
      ) {
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
    timeoutTimer.unref?.();

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
        throw new Error("cursor-acp timed out");
      }
      if (input.abortSignal?.aborted) {
        throw createAbortError(input.abortSignal.reason);
      }

      // session/update can land after the prompt result in the same flush.
      if (!(this.texts.get(sessionId) ?? "")) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }

      return {
        sessionId,
        text: this.texts.get(sessionId) ?? "",
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
    const child = this.child;
    this.child = null;
    await disposeChild(child);
  }

  private async applySessionConfig(
    sessionId: string,
    model: string,
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
    this.applied.set(sessionId, { model, mode });
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
      throw new Error("failed to spawn cursor-acp: missing stdio pipes");
    }

    const stream = acp.ndJsonStream(
      Writable.toWeb(child.stdin),
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    );

    const connection = acp
      .client({ name: "pi-agent-bridge-cursor" })
      .onRequest(acp.methods.client.session.requestPermission, async (req) => {
        const optionId = pickPermissionOption(req.params.options);
        return {
          outcome: {
            outcome: "selected" as const,
            optionId,
          },
        };
      })
      // Cursor extension methods (must register parsers for custom methods).
      .onRequest("cursor/ask_question", passthroughParams, async () => ({}))
      .onRequest("cursor/create_plan", passthroughParams, async () => ({ approved: true }))
      .onNotification(acp.methods.client.session.update, async (req) => {
        const update = req.params.update as SessionUpdate;
        if (
          update.sessionUpdate === "agent_message_chunk" &&
          update.content?.type === "text" &&
          typeof update.content.text === "string"
        ) {
          const sid = req.params.sessionId;
          this.texts.set(sid, (this.texts.get(sid) ?? "") + update.content.text);
        }
        this.listeners.get(req.params.sessionId)?.(update);
      })
      .onNotification("cursor/update_todos", passthroughParams, async () => {})
      .onNotification("cursor/task", passthroughParams, async () => {})
      .onNotification("cursor/generate_image", passthroughParams, async () => {})
      .connect(stream);

    this.connection = connection;
    this.ctx = connection.agent;

    try {
      await this.ctx.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
        },
        clientInfo: { name: "pi-agent-bridge-cursor", version: "0.1.0" },
      });
      try {
        await this.ctx.request(acp.methods.agent.authenticate, {
          methodId: "cursor_login",
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        throw new Error(
          `cursor-acp auth failed (run \`cursor-agent login\` first): ${msg}`,
        );
      }
    } catch (error) {
      const detail = stderr.trim();
      await this.dispose();
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(
        detail ? `cursor-acp initialize failed: ${msg}\n${detail}` : `cursor-acp initialize failed: ${msg}`,
      );
    }

    if (child.exitCode !== null) {
      throw new Error(
        `cursor-acp exited during startup (code ${child.exitCode})${stderr.trim() ? `: ${stderr.trim()}` : ""}`,
      );
    }
  }
}
