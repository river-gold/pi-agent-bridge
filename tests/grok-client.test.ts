import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { GrokAcpClient } from "../src/grok/client.ts";
import { loadGrokConfig } from "../src/grok/config.ts";

async function writeMockAgent(dir: string): Promise<string> {
  const path = join(dir, "mock-grok-acp.mjs");
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
      agentInfo: { name: "mock-grok-acp", version: "0" },
      authMethods: [],
    });
    continue;
  }

  if (method === "session/new") {
    const sessionId = "gsess-" + (nextId++);
    sessions.set(sessionId, { model: "grok-4.6", effort: "high" });
    ok(id, { sessionId });
    continue;
  }

  if (method === "session/resume") {
    sessions.set(params.sessionId, sessions.get(params.sessionId) ?? { model: "grok-4.6", effort: "high" });
    ok(id, { sessionId: params.sessionId });
    continue;
  }

  if (method === "session/set_model") {
    const s = sessions.get(params.sessionId);
    if (s) s.model = params.modelId;
    ok(id, { _meta: { model: { Ok: params.modelId } } });
    continue;
  }

  if (method === "session/set_mode") {
    const s = sessions.get(params.sessionId);
    if (s) s.effort = params.modeId;
    ok(id, {});
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

  if (method === "session/cancel") continue;
  if (id != null) ok(id, {});
}
`,
  );
  await chmod(path, 0o755);
  return path;
}

describe("GrokAcpClient", () => {
  it("creates session, sets model via set_model and effort via set_mode", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-grok-"));
    try {
      const mock = await writeMockAgent(dir);
      const client = new GrokAcpClient(
        loadGrokConfig({
          command: process.execPath,
          args: [mock],
          timeoutMs: 10_000,
          stateFile: join(dir, "sessions.json"),
          bindingLockFile: join(dir, "binding.lock"),
        }),
      );

      const chunks: string[] = [];
      const result = await client.runTurn({
        cwd: dir,
        model: "grok-4.6",
        effort: "xhigh",
        prompt: "hello",
        onText: (t) => chunks.push(t),
        timeoutMs: 10_000,
      });

      assert.match(result.sessionId, /^gsess-/);
      assert.equal(result.stopReason, "end_turn");
      assert.equal(
        chunks.join(""),
        "echo:hello|model:grok-4.6|effort:xhigh",
      );

      const r2 = await client.runTurn({
        sessionId: result.sessionId,
        cwd: dir,
        model: "grok-4.6",
        effort: "low",
        prompt: "again",
        timeoutMs: 10_000,
      });
      assert.equal(r2.sessionId, result.sessionId);
      assert.equal(r2.text, "echo:again|model:grok-4.6|effort:low");

      await client.dispose();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
