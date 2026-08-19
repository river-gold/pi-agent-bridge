import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { streamAgy } from "../../src/agy/stream.ts";
import {
  collectStream,
  createE2EEnv,
  destroyE2EEnv,
  makeModel,
  makeRuntime,
  multiTurnContext,
  promptArg,
  readInvocations,
  textOf,
  userContext,
  writeMockAgy,
} from "./helpers.ts";
import type { AgyModelMeta } from "../../src/agy/agy-models.ts";

describe("e2e/stream", () => {
  it("first turn: streams text, binds conversation, records usage", async () => {
    const env = await createE2EEnv();
    try {
      await writeMockAgy(
        env,
        `
if (args[0] === "models") { console.log("e2e-model\\tE2E"); process.exit(0); }
if (!has("--output-format") || flagValue("--output-format") !== "stream-json") process.exit(41);
const p = promptOf();
if (p !== "FIRST_ONLY") process.exit(42);
emit([
  { event: "init", conversation_id: "conv-main" },
  { event: "step_update", step_update: { step_type: "agent_response", text_delta: "hello ", state: "ACTIVE", conversation_id: "conv-main" } },
  { event: "step_update", step_update: { step_type: "agent_response", text_delta: "world", state: "DONE", conversation_id: "conv-main" } },
  { event: "result", result: { status: "SUCCESS", response: "hello world", usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 }, conversation_id: "conv-main" } },
]);
process.exit(0);
`,
      );

      const runtime = makeRuntime(env);
      const { events, message } = await collectStream(
        streamAgy(runtime, makeModel("e2e-model"), userContext("FIRST_ONLY"), {
          sessionId: "sess-1",
          timeoutMs: 5_000,
        }),
      );

      assert.equal(message.stopReason, "stop");
      assert.equal(textOf(message), "hello world");
      assert.equal(message.usage.input, 3);
      assert.equal(message.usage.output, 2);
      assert.equal(message.usage.totalTokens, 5);
      assert.ok(events.some((e) => e.type === "text_delta"));
      assert.ok(events.some((e) => e.type === "done"));

      const store = JSON.parse(await readFile(env.stateFile, "utf-8")) as {
        sessions: Record<string, { conversationId: string | null; prevOutput: string }>;
      };
      assert.equal(store.sessions["sess-1"]?.conversationId, "conv-main");
      assert.equal(store.sessions["sess-1"]?.prevOutput, "hello world");

      const inv = await readInvocations(env);
      assert.equal(inv.length, 1);
      assert.ok(inv[0]!.argv.includes("--dangerously-skip-permissions"));
      assert.ok(inv[0]!.argv.includes("--add-dir"));
      assert.equal(promptArg(inv[0]!.argv), "FIRST_ONLY");
      assert.ok(!promptArg(inv[0]!.argv).includes("SYSTEM_PROMPT"));
      assert.ok(!inv[0]!.argv.includes("--conversation"));
    } finally {
      await destroyE2EEnv(env);
    }
  });

  it("second turn: reuses conversation and sends only latest user text", async () => {
    const env = await createE2EEnv();
    try {
      await writeMockAgy(
        env,
        `
if (args[0] === "models") process.exit(0);
const p = promptOf();
const conv = flagValue("--conversation");
if (!conv) {
  if (p !== "turn-1") process.exit(50);
  emit([
    { event: "init", conversation_id: "conv-mt" },
    { event: "step_update", step_update: { step_type: "agent_response", text_delta: "A1", state: "DONE" } },
    { event: "result", result: { status: "SUCCESS", response: "A1", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }, conversation_id: "conv-mt" } },
  ]);
  process.exit(0);
}
if (conv !== "conv-mt") process.exit(51);
if (p !== "turn-2") process.exit(52);
if (p.includes("turn-1") || p.includes("A1") || p.includes("Previous Conversation") || p.includes("SYSTEM")) process.exit(53);
emit([
  { event: "step_update", step_update: { step_type: "agent_response", text_delta: "A2", state: "DONE" } },
  { event: "result", result: { status: "SUCCESS", response: "A2", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }, conversation_id: "conv-mt" } },
]);
process.exit(0);
`,
      );

      const runtime = makeRuntime(env);
      const model = makeModel("e2e-model");
      const sessionId = "sess-mt";

      const first = await collectStream(
        streamAgy(runtime, model, userContext("turn-1"), { sessionId, timeoutMs: 5_000 }),
      );
      assert.equal(textOf(first.message), "A1");

      const second = await collectStream(
        streamAgy(
          runtime,
          model,
          multiTurnContext([
            { user: "turn-1", assistant: "A1" },
            { user: "turn-2" },
          ]),
          { sessionId, timeoutMs: 5_000 },
        ),
      );
      assert.equal(textOf(second.message), "A2");
      assert.equal(second.message.stopReason, "stop");

      const inv = await readInvocations(env);
      assert.equal(inv.length, 2);
      assert.equal(promptArg(inv[0]!.argv), "turn-1");
      assert.ok(!inv[0]!.argv.includes("--conversation"));
      assert.equal(promptArg(inv[1]!.argv), "turn-2");
      assert.equal(inv[1]!.argv[inv[1]!.argv.indexOf("--conversation") + 1], "conv-mt");
    } finally {
      await destroyE2EEnv(env);
    }
  });

  it("thinking level maps to model suffix, not --effort", async () => {
    const env = await createE2EEnv();
    try {
      await writeMockAgy(
        env,
        `
const model = flagValue("--model");
if (model !== "gemini-3.7-flash-low") process.exit(60);
if (has("--effort")) process.exit(61);
emit([
  { event: "init", conversation_id: "c-think" },
  { event: "step_update", step_update: { step_type: "agent_response", text_delta: "ok", state: "DONE" } },
  { event: "result", result: { status: "SUCCESS", response: "ok", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
]);
process.exit(0);
`,
      );

      const meta = new Map<string, AgyModelMeta>([
        ["gemini-3.7-flash", { defaultVariant: "high", variants: ["high", "medium", "low"] }],
      ]);
      const runtime = makeRuntime(env, meta);
      const { message } = await collectStream(
        streamAgy(
          runtime,
          makeModel("gemini-3.7-flash", { variants: ["high", "medium", "low"] }),
          userContext("think"),
          { sessionId: "sess-think", reasoning: "low", timeoutMs: 5_000 },
        ),
      );
      assert.equal(textOf(message), "ok");
    } finally {
      await destroyE2EEnv(env);
    }
  });

  it("default thinking uses first discovered variant", async () => {
    const env = await createE2EEnv();
    try {
      await writeMockAgy(
        env,
        `
const model = flagValue("--model");
if (model !== "gemini-3.7-flash-high") process.exit(70);
emit([
  { event: "init", conversation_id: "c-def" },
  { event: "step_update", step_update: { step_type: "agent_response", text_delta: "d", state: "DONE" } },
  { event: "result", result: { status: "SUCCESS", response: "d", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
]);
process.exit(0);
`,
      );
      const meta = new Map<string, AgyModelMeta>([
        ["gemini-3.7-flash", { defaultVariant: "high", variants: ["high", "medium", "low"] }],
      ]);
      const runtime = makeRuntime(env, meta);
      const { message } = await collectStream(
        streamAgy(
          runtime,
          makeModel("gemini-3.7-flash", { variants: ["high", "medium", "low"] }),
          userContext("x"),
          { sessionId: "sess-def", timeoutMs: 5_000 },
        ),
      );
      assert.equal(textOf(message), "d");
    } finally {
      await destroyE2EEnv(env);
    }
  });

  it("binds conversation via .pb snapshot when stream omits id", async () => {
    const env = await createE2EEnv();
    try {
      await writeMockAgy(
        env,
        `
touchPb("pb-only-conv");
emit([
  { event: "step_update", step_update: { step_type: "agent_response", text_delta: "via-pb", state: "DONE" } },
  { event: "result", result: { status: "SUCCESS", response: "via-pb", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
]);
process.exit(0);
`,
      );
      const runtime = makeRuntime(env);
      await collectStream(
        streamAgy(runtime, makeModel("e2e-model"), userContext("pb"), {
          sessionId: "sess-pb",
          timeoutMs: 5_000,
        }),
      );
      const store = JSON.parse(await readFile(env.stateFile, "utf-8")) as {
        sessions: Record<string, { conversationId: string | null }>;
      };
      assert.equal(store.sessions["sess-pb"]?.conversationId, "pb-only-conv");
    } finally {
      await destroyE2EEnv(env);
    }
  });

  it("isolates sessions", async () => {
    const env = await createE2EEnv();
    try {
      await writeMockAgy(
        env,
        `
const p = promptOf();
const id = p === "s1" ? "conv-s1" : p === "s2" ? "conv-s2" : null;
if (!id) process.exit(80);
emit([
  { event: "init", conversation_id: id },
  { event: "step_update", step_update: { step_type: "agent_response", text_delta: id, state: "DONE" } },
  { event: "result", result: { status: "SUCCESS", response: id, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }, conversation_id: id } },
]);
process.exit(0);
`,
      );
      const runtime = makeRuntime(env);
      const model = makeModel("e2e-model");
      await collectStream(
        streamAgy(runtime, model, userContext("s1"), { sessionId: "A", timeoutMs: 5_000 }),
      );
      await collectStream(
        streamAgy(runtime, model, userContext("s2"), { sessionId: "B", timeoutMs: 5_000 }),
      );
      const store = JSON.parse(await readFile(env.stateFile, "utf-8")) as {
        sessions: Record<string, { conversationId: string | null }>;
      };
      assert.equal(store.sessions.A?.conversationId, "conv-s1");
      assert.equal(store.sessions.B?.conversationId, "conv-s2");
    } finally {
      await destroyE2EEnv(env);
    }
  });

  it("propagates agy non-zero exit as error", async () => {
    const env = await createE2EEnv();
    try {
      await writeMockAgy(
        env,
        `
console.error("mock boom");
process.exit(1);
`,
      );
      const runtime = makeRuntime(env);
      const { message } = await collectStream(
        streamAgy(runtime, makeModel("e2e-model"), userContext("x"), {
          sessionId: "sess-err",
          timeoutMs: 5_000,
        }),
      );
      assert.equal(message.stopReason, "error");
      assert.match(message.errorMessage ?? "", /mock boom/);
    } finally {
      await destroyE2EEnv(env);
    }
  });

  it("propagates result status failure", async () => {
    const env = await createE2EEnv();
    try {
      await writeMockAgy(
        env,
        `
emit([
  { event: "result", result: { status: "FAILED", error: "quota exceeded" } },
]);
process.exit(0);
`,
      );
      const runtime = makeRuntime(env);
      const { message } = await collectStream(
        streamAgy(runtime, makeModel("e2e-model"), userContext("x"), {
          sessionId: "sess-fail",
          timeoutMs: 5_000,
        }),
      );
      assert.equal(message.stopReason, "error");
      assert.match(message.errorMessage ?? "", /quota exceeded/);
    } finally {
      await destroyE2EEnv(env);
    }
  });

  it("aborts in-flight agy process", async () => {
    const env = await createE2EEnv();
    try {
      const started = join(env.root, "abort-started");
      await writeMockAgy(
        env,
        `
import { writeFileSync as w } from "node:fs";
w(${JSON.stringify(started)}, "");
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30_000);
emit([
  { event: "init", conversation_id: "late" },
  { event: "step_update", step_update: { step_type: "agent_response", text_delta: "too-late", state: "DONE" } },
  { event: "result", result: { status: "SUCCESS", response: "too-late", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
]);
process.exit(0);
`,
      );
      // rewrite without double import — writeMockAgy already imports fs
      await writeMockAgy(
        env,
        `
writeFileSync(${JSON.stringify(started)}, "");
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30_000);
emit([
  { event: "init", conversation_id: "late" },
  { event: "step_update", step_update: { step_type: "agent_response", text_delta: "too-late", state: "DONE" } },
  { event: "result", result: { status: "SUCCESS", response: "too-late", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
]);
process.exit(0);
`,
      );

      const runtime = makeRuntime(env);
      const ac = new AbortController();
      const stream = streamAgy(runtime, makeModel("e2e-model"), userContext("abort-me"), {
        sessionId: "sess-abort",
        timeoutMs: 15_000,
        signal: ac.signal,
      });

      const waitStarted = (async () => {
        for (let i = 0; i < 100; i++) {
          try {
            await readFile(started);
            return;
          } catch {
            await new Promise((r) => setTimeout(r, 50));
          }
        }
        throw new Error("mock never started");
      })();
      await waitStarted;
      ac.abort();

      const { message } = await collectStream(stream);
      assert.equal(message.stopReason, "aborted");
    } finally {
      await destroyE2EEnv(env);
    }
  });

  it("times out hung agy", async () => {
    const env = await createE2EEnv();
    try {
      await writeMockAgy(
        env,
        `
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30_000);
process.exit(0);
`,
      );
      const runtime = makeRuntime(env);
      runtime.config = { ...runtime.config, timeoutMs: 300 };
      const { message } = await collectStream(
        streamAgy(runtime, makeModel("e2e-model"), userContext("slow"), {
          sessionId: "sess-to",
          timeoutMs: 300,
        }),
      );
      assert.equal(message.stopReason, "error");
      assert.match(message.errorMessage ?? "", /timed out/i);
    } finally {
      await destroyE2EEnv(env);
    }
  });

  it("errors when no user text", async () => {
    const env = await createE2EEnv();
    try {
      await writeMockAgy(env, `process.exit(0);`);
      const runtime = makeRuntime(env);
      const { message } = await collectStream(
        streamAgy(
          runtime,
          makeModel("e2e-model"),
          { systemPrompt: "only-system", messages: [] },
          { sessionId: "sess-empty", timeoutMs: 5_000 },
        ),
      );
      assert.equal(message.stopReason, "error");
      assert.match(message.errorMessage ?? "", /no user text/);
    } finally {
      await destroyE2EEnv(env);
    }
  });

  it("does not forward system prompt or tools in -p", async () => {
    const env = await createE2EEnv();
    try {
      await writeMockAgy(
        env,
        `
const p = promptOf();
if (p.includes("SYSTEM_PROMPT_MUST_NOT_LEAK")) process.exit(90);
if (p.includes("TOOL_MUST_NOT_LEAK")) process.exit(91);
if (p !== "pure-user") process.exit(92);
emit([
  { event: "init", conversation_id: "c-pure" },
  { event: "step_update", step_update: { step_type: "agent_response", text_delta: "ok", state: "DONE" } },
  { event: "result", result: { status: "SUCCESS", response: "ok", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
]);
process.exit(0);
`,
      );
      const runtime = makeRuntime(env);
      const { message } = await collectStream(
        streamAgy(runtime, makeModel("e2e-model"), userContext("pure-user"), {
          sessionId: "sess-pure",
          timeoutMs: 5_000,
        }),
      );
      assert.equal(textOf(message), "ok");
    } finally {
      await destroyE2EEnv(env);
    }
  });

  it("uses cwd from runtime", async () => {
    const env = await createE2EEnv();
    try {
      await writeMockAgy(
        env,
        `
import { realpathSync } from "node:fs";
const expected = realpathSync(${JSON.stringify(env.cwd)});
const actualCwd = realpathSync(process.cwd());
if (actualCwd !== expected) process.exit(95);
const add = flagValue("--add-dir");
if (!add || realpathSync(add) !== expected) process.exit(96);
emit([
  { event: "init", conversation_id: "c-cwd" },
  { event: "step_update", step_update: { step_type: "agent_response", text_delta: "cwd-ok", state: "DONE" } },
  { event: "result", result: { status: "SUCCESS", response: "cwd-ok", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
]);
process.exit(0);
`,
      );
      const runtime = makeRuntime(env);
      const { message } = await collectStream(
        streamAgy(runtime, makeModel("e2e-model"), userContext("cwd"), {
          sessionId: "sess-cwd",
          timeoutMs: 5_000,
        }),
      );
      assert.equal(textOf(message), "cwd-ok");
    } finally {
      await destroyE2EEnv(env);
    }
  });

  it("non-streamed result still yields text via extract path", async () => {
    const env = await createE2EEnv();
    try {
      await writeMockAgy(
        env,
        `
// result only, no step_update text deltas
emit([
  { event: "init", conversation_id: "c-ns" },
  { event: "result", result: { status: "SUCCESS", response: "from-result", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }, conversation_id: "c-ns" } },
]);
process.exit(0);
`,
      );
      const runtime = makeRuntime(env);
      const { message } = await collectStream(
        streamAgy(runtime, makeModel("e2e-model"), userContext("ns"), {
          sessionId: "sess-ns",
          timeoutMs: 5_000,
        }),
      );
      assert.equal(textOf(message), "from-result");
    } finally {
      await destroyE2EEnv(env);
    }
  });
});
