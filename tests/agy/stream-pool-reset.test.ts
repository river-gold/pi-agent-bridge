import { describe, expect, it, vi } from "vitest";
import { streamAgyPool, type PoolRuntime } from "../../extensions/antigravity.ts";
import { compositeKey } from "../../src/agy/agy-pool.ts";
import type { Context, Model } from "@earendil-works/pi-ai";

describe("streamAgyPool conversation reset", () => {
  const model: Model<"openai-completions"> = {
    id: "gemini-flash",
    name: "Gemini Flash",
    api: "openai-completions",
    provider: "antigravity",
    baseUrl: "pi-agent-bridge://antigravity",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 4096,
  };

  it("disposes pooled entry and clears store when foreign activity is detected", async () => {
    const cwd = "/tmp/test-cwd";
    const sessionId = "test-session";
    const poolKey = compositeKey(sessionId, cwd);

    const disposedKeys: string[] = [];
    const storeSets: Array<[string, string | null, string | undefined]> = [];
    let acquiredConvId: string | undefined = "UNSET";

    const mockPromptResult = {
      stdout: "hello from new turn",
      conversationId: "new-conv-id",
    };

    const mockHandle = {
      key: poolKey,
      prompt: vi.fn().mockImplementation((_prompt, opts) => {
        opts?.onEvent?.({ type: "text", text: "hello from new turn" });
        return Promise.resolve(mockPromptResult);
      }),
    };

    const mockRuntime: PoolRuntime = {
      config: {
        conversationsDir: "/tmp/conversations",
        timeoutMs: 5000,
        binary: "agy",
        extraArgs: [],
        stateFile: "/tmp/state.json",
        modelCacheFile: "/tmp/cache.json",
        bindingLockFile: "/tmp/lock",
      },
      getCwd: () => cwd,
      getMeta: () => undefined,
      store: {
        getEntry: vi.fn().mockResolvedValue({ conversationId: "old-conv-id", prevOutput: "" }),
        acquireBindingLock: vi.fn().mockResolvedValue(() => Promise.resolve()),
        set: vi.fn().mockImplementation((k, c, p) => {
          storeSets.push([k, c, p]);
          return Promise.resolve();
        }),
      },
      pool: {
        peekModelEffort: vi.fn().mockReturnValue({ model: "gemini-flash", effort: undefined }),
        has: vi.fn().mockReturnValue(true),
        disposeKey: vi.fn().mockImplementation((k: string) => {
          disposedKeys.push(k);
          return Promise.resolve(true);
        }),
        acquire: vi.fn().mockImplementation((_session, _cwd, _m, _eff, convId) => {
          acquiredConvId = convId;
          return mockHandle;
        }),
      },
    };

    const context: Context = {
      messages: [
        { role: "user", content: "first user prompt", timestamp: 1 },
        {
          role: "assistant",
          provider: "antigravity",
          api: "openai-completions",
          model: "gemini-flash",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop",
          timestamp: 2,
          content: [{ type: "text", text: "first response" }],
        },
        { role: "user", content: "middle prompt", timestamp: 3 },
        {
          role: "assistant",
          provider: "open-router",
          api: "openai-completions",
          model: "some-other-model",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop",
          timestamp: 4,
          content: [{ type: "text", text: "foreign assistant response" }],
        },
        { role: "user", content: "latest user prompt", timestamp: 5 },
      ],
    };

    const stream = streamAgyPool(mockRuntime, model, context, { sessionId });
    const events = [];
    for await (const event of stream) {
      events.push(event);
    }

    // 1. disposeKey was called with the poolKey to terminate the old process
    expect(disposedKeys).toEqual([poolKey]);

    // 2. session store was reset before acquiring
    expect(storeSets[0]).toEqual([poolKey, null, ""]);

    // 3. acquire was called without the old conversation ID (so a fresh conversation starts)
    expect(acquiredConvId).toBeUndefined();

    // 4. new conversation ID is ultimately saved to store at the end of the turn
    expect(storeSets[storeSets.length - 1][1]).toBe("new-conv-id");
  });

  it("does not dispose or reset when there is no foreign activity and model is unchanged", async () => {
    const cwd = "/tmp/test-cwd";
    const sessionId = "test-session-continue";
    const poolKey = compositeKey(sessionId, cwd);

    const disposedKeys: string[] = [];
    let acquiredConvId: string | undefined = "UNSET";

    const mockHandle = {
      key: poolKey,
      prompt: vi.fn().mockResolvedValue({
        stdout: "continued response",
        conversationId: "old-conv-id",
      }),
    };

    const mockRuntime: PoolRuntime = {
      config: {
        conversationsDir: "/tmp/conversations",
        timeoutMs: 5000,
        binary: "agy",
        extraArgs: [],
        stateFile: "/tmp/state.json",
        modelCacheFile: "/tmp/cache.json",
        bindingLockFile: "/tmp/lock",
      },
      getCwd: () => cwd,
      getMeta: () => undefined,
      store: {
        getEntry: vi.fn().mockResolvedValue({ conversationId: "old-conv-id", prevOutput: "" }),
        acquireBindingLock: vi.fn().mockResolvedValue(() => Promise.resolve()),
        set: vi.fn().mockResolvedValue(undefined),
      },
      pool: {
        peekModelEffort: vi.fn().mockReturnValue({ model: "gemini-flash", effort: undefined }),
        has: vi.fn().mockReturnValue(true),
        disposeKey: vi.fn().mockImplementation((k: string) => {
          disposedKeys.push(k);
          return Promise.resolve(true);
        }),
        acquire: vi.fn().mockImplementation((_session, _cwd, _m, _eff, convId) => {
          acquiredConvId = convId;
          return mockHandle;
        }),
      },
    };

    const context: Context = {
      messages: [
        { role: "user", content: "first user prompt", timestamp: 1 },
        {
          role: "assistant",
          provider: "antigravity",
          api: "openai-completions",
          model: "gemini-flash",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop",
          timestamp: 2,
          content: [{ type: "text", text: "first response" }],
        },
        { role: "user", content: "second prompt", timestamp: 3 },
      ],
    };

    const stream = streamAgyPool(mockRuntime, model, context, { sessionId });
    for await (const _ of stream) {
    }

    expect(disposedKeys).toEqual([]);
    expect(acquiredConvId).toBe("old-conv-id");
  });
});
