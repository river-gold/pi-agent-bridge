import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { CursorAcpClient } from "../src/cursor/client.ts";
import { loadCursorConfig } from "../src/cursor/config.ts";

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
      agentCapabilities: { loadSession: true, sessionCapabilities: { list: {} } },
      agentInfo: { name: "mock-cursor-acp", version: "0" },
      authMethods: [{ id: "cursor_login", name: "Cursor Login" }],
    });
    continue;
  }
  if (method === "authenticate") { ok(id, {}); continue; }
  if (method === "session/new") {
    const sessionId = "csess-" + (nextId++);
    sessions.set(sessionId, { model: "default[]", mode: "agent" });
    ok(id, {
      sessionId,
      modes: { currentModeId: "agent", availableModes: [{ id: "agent", name: "Agent" }] },
      configOptions: [{
        id: "model", type: "select", name: "Model", category: "model",
        currentValue: "default[]",
        options: [{ value: "default[]", name: "Auto" }],
      }],
    });
    continue;
  }
  if (method === "session/load") {
    sessions.set(params.sessionId, sessions.get(params.sessionId) ?? { model: "default[]", mode: "agent" });
    ok(id, { sessionId: params.sessionId });
    continue;
  }
  if (method === "session/set_mode") {
    const s = sessions.get(params.sessionId);
    if (s) s.mode = params.modeId;
    ok(id, {});
    continue;
  }
  if (method === "session/set_config_option") {
    const s = sessions.get(params.sessionId);
    if (s && params.configId === "model") s.model = params.value;
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
        content: { type: "text", text: "echo:" + text + "|model:" + s.model + "|mode:" + s.mode },
      },
    });
    ok(id, { stopReason: "end_turn" });
    continue;
  }
  if (method === "session/cancel") continue;
  if (id != null) ok(id, {});
}
`,
  );
  await chmod(path, 0o755);
  return path;
}

describe("CursorAcpClient", () => {
  it("auths, sets default[] model, streams text", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-cursor-"));
    try {
      const mock = await writeMockAgent(dir);
      const client = new CursorAcpClient(
        loadCursorConfig({
          command: process.execPath,
          args: [mock],
          timeoutMs: 10_000,
          mode: "agent",
          stateFile: join(dir, "sessions.json"),
          bindingLockFile: join(dir, "binding.lock"),
        }),
      );

      const result = await client.runTurn({
        cwd: dir,
        model: "default[]",
        prompt: "hello",
        timeoutMs: 10_000,
      });

      assert.match(result.sessionId, /^csess-/);
      assert.equal(result.stopReason, "end_turn");
      assert.equal(result.text, "echo:hello|model:default[]|mode:agent");
      await client.dispose();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
