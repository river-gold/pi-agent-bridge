import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type {
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Model,
} from "@earendil-works/pi-ai";
import { GrokAcpClient } from "../../src/grok/client.ts";
import { loadGrokConfig } from "../../src/grok/config.ts";
import { toPiModels } from "../../src/grok/models.ts";
import { streamGrok, type GrokStreamRuntime } from "../../src/grok/stream.ts";
import { SessionStore } from "../../src/shared/session-store.ts";

async function writeMockAgent(dir: string): Promise<string> {
  const path = join(dir, "mock-grok-acp.mjs");
  await writeFile(
    path,
    `#!${process.execPath}
import readline from "node:readline";
const sessions = new Map();
let nextId = 1;
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
function send(msg) { process.stdout.write(JSON.stringify(msg) + "\\n"); }
function ok(id, result) { send({ jsonrpc: "2.0", id, result }); }
function notify(method, params) { send({ jsonrpc: "2.0", method, params }); }
for await (const line of rl) {
  if (!line.trim()) continue;
  let msg; try { msg = JSON.parse(line); } catch { continue; }
  if (!msg?.method) continue;
  const { id, method, params } = msg;
  if (method === "initialize") {
    ok(id, {
      protocolVersion: params.protocolVersion,
      agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} } },
      agentInfo: { name: "mock", version: "0" },
      authMethods: [],
    });
    continue;
  }
  if (method === "session/new") {
    const sessionId = "e2e-g-" + (nextId++);
    sessions.set(sessionId, { model: "grok-4.6", effort: "high" });
    ok(id, { sessionId });
    continue;
  }
  if (method === "session/resume") { ok(id, { sessionId: params.sessionId }); continue; }
  if (method === "session/set_model") {
    const s = sessions.get(params.sessionId) ?? {};
    s.model = params.modelId;
    sessions.set(params.sessionId, s);
    ok(id, {});
    continue;
  }
  if (method === "session/set_mode") {
    const s = sessions.get(params.sessionId) ?? {};
    s.effort = params.modeId;
    sessions.set(params.sessionId, s);
    ok(id, {});
    continue;
  }
  if (method === "session/prompt") {
    const s = sessions.get(params.sessionId) ?? {};
    const text = (params.prompt ?? []).filter(b => b.type === "text").map(b => b.text).join("");
    notify("session/update", {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "R:" + text + ":" + s.model + ":" + s.effort },
      },
    });
    ok(id, { stopReason: "end_turn" });
    continue;
  }
  if (id != null) ok(id, {});
}
`,
  );
  await chmod(path, 0o755);
  return path;
}

function userContext(text: string): Context {
  return {
    messages: [{ role: "user", content: text, timestamp: Date.now() } as never],
  };
}

async function collectStream(
  stream: AsyncIterable<AssistantMessageEvent>,
): Promise<{ events: AssistantMessageEvent[]; message: AssistantMessage }> {
  const events: AssistantMessageEvent[] = [];
  let message: AssistantMessage | undefined;
  for await (const event of stream) {
    events.push(event);
    if (event.type === "done") message = event.message;
    if (event.type === "error") message = event.error;
  }
  assert.ok(message);
  return { events, message };
}

function textOf(message: AssistantMessage): string {
  return message.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
}

describe("e2e/grok-stream", () => {
  it("streams text, binds session, reuses on second turn", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-grok-e2e-"));
    const cwd = join(root, "cwd");
    const stateDir = join(root, "state");
    await mkdir(cwd, { recursive: true });
    await mkdir(stateDir, { recursive: true });
    try {
      const mock = await writeMockAgent(root);
      const config = loadGrokConfig({
        command: process.execPath,
        args: [mock],
        timeoutMs: 10_000,
        stateFile: join(stateDir, "sessions.json"),
        bindingLockFile: join(stateDir, "binding.lock"),
      });
      const { models, meta } = toPiModels();
      const client = new GrokAcpClient(config);
      const runtime: GrokStreamRuntime = {
        config,
        getCwd: () => cwd,
        getMeta: (id) => meta.get(id),
        store: new SessionStore(config.stateFile, config.bindingLockFile),
        client,
      };
      const model = models.find((m) => m.id === "grok-4.6") as Model<"grok-acp">;

      const t1 = await collectStream(
        streamGrok(runtime, model, userContext("first"), {
          sessionId: "pi-sess",
          reasoning: "medium",
          timeoutMs: 10_000,
        }),
      );
      assert.equal(t1.message.stopReason, "stop");
      assert.equal(textOf(t1.message), "R:first:grok-4.6:medium");

      const entry = await runtime.store.getEntry("pi-sess");
      assert.ok(entry?.conversationId);

      const t2 = await collectStream(
        streamGrok(runtime, model, userContext("second"), {
          sessionId: "pi-sess",
          reasoning: "xhigh",
          timeoutMs: 10_000,
        }),
      );
      assert.equal(t2.message.stopReason, "stop");
      assert.equal(textOf(t2.message), "R:second:grok-4.6:xhigh");
      assert.equal(
        (await runtime.store.getEntry("pi-sess"))?.conversationId,
        entry!.conversationId,
      );

      await client.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
