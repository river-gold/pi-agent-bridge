import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
  createAssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import type { GrokConfig } from "./config.ts";
import { GrokAcpClient } from "./client.ts";
import { resolveGrokConfig, type GrokModelMeta } from "./models.ts";
import { mapPrompt } from "../shared/prompt-mapper.ts";
import { SessionStore } from "../shared/session-store.ts";

export interface GrokStreamRuntime {
  config: GrokConfig;
  getCwd: () => string;
  getMeta: (modelId: string) => GrokModelMeta | undefined;
  store: SessionStore;
  client: GrokAcpClient;
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

export function streamGrok(
  runtime: GrokStreamRuntime,
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();

  (async () => {
    const output = createOutput(model);
    let releaseBindingLock: (() => Promise<void>) | null = null;

    try {
      stream.push({ type: "start", partial: output });

      const deadline = Date.now() + (options?.timeoutMs ?? runtime.config.timeoutMs);
      const remainingTimeout = () => {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error("grok-acp timed out");
        return remaining;
      };

      const sessionKey = options?.sessionId?.trim() || "default";
      let entry = await runtime.store.getEntry(sessionKey);
      remainingTimeout();
      let acpSessionId = entry?.conversationId ?? null;

      if (!acpSessionId) {
        try {
          releaseBindingLock = await runtime.store.acquireBindingLock({
            abortSignal: options?.signal,
            timeoutMs: remainingTimeout(),
          });
        } catch (error) {
          if (error instanceof Error && error.name === "TimeoutError") {
            throw new Error("grok-acp timed out");
          }
          throw error;
        }
        entry = await runtime.store.getEntry(sessionKey);
        remainingTimeout();
        acpSessionId = entry?.conversationId ?? null;
      }

      const prompt = mapPrompt(context.messages);
      remainingTimeout();
      if (!prompt.trim()) {
        throw new Error("grok turn has no user text");
      }

      const resolved = resolveGrokConfig(
        model.id,
        options?.reasoning,
        runtime.getMeta(model.id),
      );

      let textStarted = false;
      const contentIndex = 0;
      const pushText = (text: string) => {
        if (!text) return;
        if (!textStarted) {
          output.content.push({ type: "text", text: "" });
          stream.push({ type: "text_start", contentIndex, partial: output });
          textStarted = true;
        }
        const block = output.content[contentIndex];
        if (block?.type === "text") {
          block.text += text;
          stream.push({
            type: "text_delta",
            contentIndex,
            delta: text,
            partial: output,
          });
        }
      };

      const result = await runtime.client.runTurn({
        sessionId: acpSessionId ?? undefined,
        cwd: runtime.getCwd(),
        model: resolved.model,
        effort: resolved.effort,
        prompt,
        timeoutMs: remainingTimeout(),
        abortSignal: options?.signal,
        onText: pushText,
      });

      acpSessionId = result.sessionId;

      if (textStarted) {
        const block = output.content[contentIndex];
        if (block?.type === "text") {
          stream.push({
            type: "text_end",
            contentIndex,
            content: block.text,
            partial: output,
          });
        }
      } else if (result.text) {
        pushText(result.text);
        const block = output.content[contentIndex];
        if (block?.type === "text") {
          stream.push({
            type: "text_end",
            contentIndex,
            content: block.text,
            partial: output,
          });
        }
      }

      await runtime.store.set(sessionKey, acpSessionId, "");

      if (result.stopReason === "cancelled") {
        output.stopReason = options?.signal?.aborted ? "aborted" : "error";
        if (output.stopReason === "error") {
          output.errorMessage = "grok-acp cancelled";
        }
        stream.push({
          type: "error",
          reason: output.stopReason,
          error: output,
        });
        stream.end();
        return;
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
