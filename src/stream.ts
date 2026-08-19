import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
  calculateCost,
  createAssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import type { AgyConfig } from "./config.ts";
import { findNewConversation, snapshot } from "./conversation-tracker.ts";
import { extractDelta } from "./extract-delta.ts";
import { resolveAgyModelId, type AgyModelMeta } from "./agy-models.ts";
import { boundTurnMessages, mapPrompt } from "./prompt-mapper.ts";
import { runAgyStream } from "./agy-runner.ts";
import { SessionStore } from "./session-store.ts";

export interface StreamRuntime {
  config: AgyConfig;
  getCwd: () => string;
  getMeta: (modelId: string) => AgyModelMeta | undefined;
  store: SessionStore;
}

const prevOutputs = new Map<string, string>();

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

export function streamAgy(
  runtime: StreamRuntime,
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
        if (remaining <= 0) throw new Error("agy timed out");
        return remaining;
      };

      const sessionKey = options?.sessionId?.trim() || "default";
      let entry = await runtime.store.getEntry(sessionKey);
      remainingTimeout();
      let conversationId = entry?.conversationId ?? null;

      if (!conversationId) {
        try {
          releaseBindingLock = await runtime.store.acquireBindingLock({
            abortSignal: options?.signal,
            timeoutMs: remainingTimeout(),
          });
        } catch (error) {
          if (error instanceof Error && error.name === "TimeoutError") {
            throw new Error("agy timed out");
          }
          throw error;
        }
        entry = await runtime.store.getEntry(sessionKey);
        remainingTimeout();
        conversationId = entry?.conversationId ?? null;
      }

      const before = conversationId ? null : await snapshot(runtime.config.conversationsDir);
      remainingTimeout();

      const turnMessages = conversationId
        ? boundTurnMessages(context.messages)
        : context.messages;
      const prompt = mapPrompt(turnMessages);
      remainingTimeout();

      if (conversationId && !prompt.trim()) {
        throw new Error("agy bound turn has no current-turn text");
      }

      const resolved = resolveAgyModelId(
        model.id,
        options?.reasoning,
        runtime.getMeta(model.id),
      );

      let streamed = false;
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
          stream.push({ type: "text_delta", contentIndex, delta: text, partial: output });
        }
        streamed = true;
      };

      const result = await runAgyStream(
        {
          prompt,
          cwd: runtime.getCwd(),
          conversationId: conversationId ?? undefined,
          model: resolved.model,
          effort: resolved.effort,
          binary: runtime.config.binary,
          extraArgs: runtime.config.extraArgs,
          timeoutMs: remainingTimeout(),
          abortSignal: options?.signal,
        },
        (event) => {
          if (event.type === "conversation" && !conversationId) {
            conversationId = event.id;
          }
          if (event.type === "text" && event.text) {
            pushText(event.text);
          }
        },
      );

      if (!conversationId && result.conversationId) {
        conversationId = result.conversationId;
      }
      if (!conversationId && before) {
        conversationId = await findNewConversation(before, runtime.config.conversationsDir);
      }

      let prevOutput = prevOutputs.get(sessionKey) ?? "";
      if (!prevOutput && entry?.prevOutput) {
        prevOutput = entry.prevOutput;
        prevOutputs.set(sessionKey, prevOutput);
      }

      const delta = extractDelta(prevOutput, result.stdout, !!conversationId);
      if (!streamed && delta) pushText(delta);

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
      }

      if (conversationId) prevOutputs.set(sessionKey, result.stdout);
      else prevOutputs.delete(sessionKey);

      await runtime.store.set(
        sessionKey,
        conversationId,
        conversationId ? result.stdout : "",
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
