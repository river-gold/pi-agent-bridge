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
import { CursorAcpClient } from "../../src/cursor/client.ts";
import { loadCursorConfig } from "../../src/cursor/config.ts";
import { toPiModels } from "../../src/cursor/models.ts";
import { streamCursor, type CursorStreamRuntime } from "../../src/cursor/stream.ts";
import { SessionStore } from "../../src/shared/session-store.ts";

async function writeMockAgent(dir: string): Promise<string> {
  const path = join(dir, "mock-cursor-acp.mjs");
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
      agentCapabilities: { loadSession: true },
      agentInfo: { name: "mock", version: "0" },
      authMethods: [{ id: "cursor_login", name: "Cursor Login" }],
    });
    continue;
  }
  if (method === "authenticate") { ok(id, {}); continue; }
  if (method === "session/new") {
    const sessionId = "e2e-c-" + (nextId++);
    sessions.set(sessionId, { model: "default[]", mode: "agent" });
    ok(id, { sessionId });
    continue;
  }
  if (method === "session/load") { ok(id, { sessionId: params.sessionId }); continue; }
  if (method === "session/set_mode") {
    const s = sessions.get(params.sessionId) ?? {};
    s.mode = params.modeId;
    sessions.set(params.sessionId, s);
    ok(id, {});
    continue;
  }
  if (method === "session/set_config_option") {
    const s = sessions.get(params.sessionId) ?? {};
    if (params.configId === "model") s.model = params.value;
    sessions.set(params.sessionId, s);
    ok(id, { configOptions: [] });
    continue;
  }
  if (method === "session/prompt") {
    const s = sessions.get(params.sessionId) ?? {};
    const text = (params.prompt ?? []).filter(b => b.type === "text").map(b => b.text).join("");
    notify("session/update", {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "R:" + text + ":" + s.model },
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
): Promise<{ message: AssistantMessage }> {
  let message: AssistantMessage | undefined;
  for await (const event of stream) {
    if (event.type === "done") message = event.message;
    if (event.type === "error") message = event.error;
  }
  assert.ok(message);
  return { message };
}

function textOf(message: AssistantMessage): string {
  return message.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
}

describe("e2e/cursor-stream", () => {
  it("streams text with auto→default[] and reuses session", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-cursor-e2e-"));
    const cwd = join(root, "cwd");
    const stateDir = join(root, "state");
    await mkdir(cwd, { recursive: true });
    await mkdir(stateDir, { recursive: true });
    try {
      const mock = await writeMockAgent(root);
      const config = loadCursorConfig({
        command: process.execPath,
        args: [mock],
        timeoutMs: 10_000,
        mode: "agent",
        stateFile: join(stateDir, "sessions.json"),
        bindingLockFile: join(stateDir, "binding.lock"),
      });
      const { models, meta } = toPiModels();
      const client = new CursorAcpClient(config);
      const runtime: CursorStreamRuntime = {
        config,
        getCwd: () => cwd,
        getMeta: (id) => meta.get(id),
        store: new SessionStore(config.stateFile, config.bindingLockFile),
        client,
      };
      const model = models.find((m) => m.id === "auto") as Model<"cursor-acp">;

      const t1 = await collectStream(
        streamCursor(runtime, model, userContext("first"), {
          sessionId: "pi-sess",
          timeoutMs: 10_000,
        }),
      );
      assert.equal(t1.message.stopReason, "stop");
      assert.equal(textOf(t1.message), "R:first:default[]");

      const entry = await runtime.store.getEntry("pi-sess");
      assert.ok(entry?.conversationId);

      const t2 = await collectStream(
        streamCursor(runtime, model, userContext("second"), {
          sessionId: "pi-sess",
          timeoutMs: 10_000,
        }),
      );
      assert.equal(t2.message.stopReason, "stop");
      assert.equal(textOf(t2.message), "R:second:default[]");
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
