import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { CodexAcpClient } from "../src/codex/client.ts";
import { loadCodexConfig } from "../src/codex/config.ts";

/**
 * Minimal ACP agent mock that speaks enough of the protocol for CodexAcpClient.
 */
async function writeMockAgent(dir: string): Promise<string> {
  const path = join(dir, "mock-codex-acp.mjs");
  await writeFile(
    path,
    `#!${process.execPath}
import readline from "node:readline";

const sessions = new Map();
let nextId = 1;
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\\n");
}

function ok(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function notify(method, params) {
  send({ jsonrpc: "2.0", method, params });
}

for await (const line of rl) {
  if (!line.trim()) continue;
  let msg;
  try { msg = JSON.parse(line); } catch { continue; }
  if (!msg || typeof msg !== "object" || msg.method == null) continue;
  const { id, method, params } = msg;

  if (method === "initialize") {
    ok(id, {
      protocolVersion: params.protocolVersion,
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: { image: false, embeddedContext: true },
        sessionCapabilities: { resume: {}, close: {} },
      },
      agentInfo: { name: "mock-codex-acp", version: "0" },
      authMethods: [],
    });
    continue;
  }

  if (method === "session/new") {
    const sessionId = "sess-" + (nextId++);
    sessions.set(sessionId, { model: "gpt-5.6-sol", effort: "high", mode: "agent" });
    ok(id, {
      sessionId,
      configOptions: [
        { id: "model", type: "select", name: "Model", category: "model", currentValue: "gpt-5.6-sol", options: [] },
        { id: "reasoning_effort", type: "select", name: "Effort", category: "thought_level", currentValue: "high", options: [] },
      ],
    });
    continue;
  }

  if (method === "session/resume") {
    sessions.set(params.sessionId, sessions.get(params.sessionId) ?? { model: "gpt-5.6-sol", effort: "high", mode: "agent" });
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
    if (s && params.configId === "reasoning_effort") s.effort = params.value;
    ok(id, { configOptions: [] });
    continue;
  }

  if (method === "session/prompt") {
    const s = sessions.get(params.sessionId) ?? {};
    const text = (params.prompt ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    const reply = "echo:" + text + "|model:" + s.model + "|effort:" + s.effort;
    notify("session/update", {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: reply },
      },
    });
    ok(id, { stopReason: "end_turn" });
    continue;
  }

  if (method === "session/cancel") {
    continue;
  }

  if (id != null) ok(id, {});
}
`,
  );
  await chmod(path, 0o755);
  return path;
}

describe("CodexAcpClient", () => {
  it("creates session, sets model/effort, streams text", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-codex-"));
    try {
      const mock = await writeMockAgent(dir);
      const client = new CodexAcpClient(
        loadCodexConfig({
          command: process.execPath,
          args: [mock],
          timeoutMs: 10_000,
          mode: "agent-full-access",
          stateFile: join(dir, "sessions.json"),
          bindingLockFile: join(dir, "binding.lock"),
        }),
      );

      const chunks: string[] = [];
      const result = await client.runTurn({
        cwd: dir,
        model: "gpt-5.6-luna",
        effort: "low",
        prompt: "hello",
        onText: (t) => chunks.push(t),
        timeoutMs: 10_000,
      });

      assert.match(result.sessionId, /^sess-/);
      assert.equal(result.stopReason, "end_turn");
      assert.equal(chunks.join(""), "echo:hello|model:gpt-5.6-luna|effort:low");
      assert.equal(result.text, "echo:hello|model:gpt-5.6-luna|effort:low");

      // second turn reuses session and can change effort
      const r2 = await client.runTurn({
        sessionId: result.sessionId,
        cwd: dir,
        model: "gpt-5.6-luna",
        effort: "max",
        prompt: "again",
        timeoutMs: 10_000,
      });
      assert.equal(r2.sessionId, result.sessionId);
      assert.equal(r2.text, "echo:again|model:gpt-5.6-luna|effort:max");

      await client.dispose();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
