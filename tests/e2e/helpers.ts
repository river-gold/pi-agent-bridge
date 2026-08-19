import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Model,
} from "@earendil-works/pi-ai";
import { loadConfig, type AgyConfig } from "../../src/config.ts";
import { SessionStore } from "../../src/session-store.ts";
import { streamAgy, type StreamRuntime } from "../../src/stream.ts";
import type { AgyModelMeta } from "../../src/agy-models.ts";

export interface E2EEnv {
  root: string;
  cwd: string;
  conversationsDir: string;
  stateFile: string;
  bindingLockFile: string;
  modelCacheFile: string;
  invocationLog: string;
  mockBinary: string;
  config: AgyConfig;
}

export async function createE2EEnv(prefix = "pi-agy-e2e-"): Promise<E2EEnv> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const cwd = join(root, "cwd");
  const conversationsDir = join(root, "conversations");
  const stateDir = join(root, "state");
  const cacheDir = join(root, "cache");
  await Promise.all([
    mkdir(cwd, { recursive: true }),
    mkdir(conversationsDir, { recursive: true }),
    mkdir(stateDir, { recursive: true }),
    mkdir(cacheDir, { recursive: true }),
  ]);

  const stateFile = join(stateDir, "sessions.json");
  const bindingLockFile = join(stateDir, "binding.lock");
  const modelCacheFile = join(cacheDir, "models.json");
  const invocationLog = join(root, "invocations.ndjson");
  const mockBinary = join(root, "mock-agy.mjs");
  await writeFile(invocationLog, "", "utf-8");

  const config = loadConfig({
    binary: mockBinary,
    timeoutMs: 10_000,
    extraArgs: [],
    conversationsDir,
    stateFile,
    modelCacheFile,
    bindingLockFile,
  });

  return {
    root,
    cwd,
    conversationsDir,
    stateFile,
    bindingLockFile,
    modelCacheFile,
    invocationLog,
    mockBinary,
    config,
  };
}

export async function destroyE2EEnv(env: E2EEnv): Promise<void> {
  await rm(env.root, { recursive: true, force: true });
}

/** Mock agy that logs invocations and emits stream-json responses. */
export async function writeMockAgy(env: E2EEnv, scriptBody: string): Promise<void> {
  const full = `#!${process.execPath}
import { appendFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const logPath = ${JSON.stringify(env.invocationLog)};
const conversationsDir = ${JSON.stringify(env.conversationsDir)};

function log(entry) {
  appendFileSync(logPath, JSON.stringify(entry) + "\\n");
}

function emit(events) {
  for (const event of events) console.log(JSON.stringify(event));
}

function promptOf() {
  const i = args.indexOf("-p");
  return i >= 0 ? (args[i + 1] ?? "") : "";
}

function has(flag) {
  return args.includes(flag);
}

function flagValue(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function touchPb(id) {
  mkdirSync(conversationsDir, { recursive: true });
  writeFileSync(join(conversationsDir, id + ".pb"), "");
}

log({ cwd: process.cwd(), argv: args, at: Date.now() });

${scriptBody}
`;
  await writeFile(env.mockBinary, full, "utf-8");
  await chmod(env.mockBinary, 0o755);
}

export async function readInvocations(
  env: E2EEnv,
): Promise<Array<{ cwd: string; argv: string[]; at: number }>> {
  const raw = await readFile(env.invocationLog, "utf-8");
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { cwd: string; argv: string[]; at: number });
}

export function makeModel(
  id: string,
  opts?: { reasoning?: boolean; variants?: string[] },
): Model<"agy-cli"> {
  const variants = opts?.variants ?? [];
  const reasoning = opts?.reasoning ?? variants.length >= 2;
  return {
    id,
    name: id,
    api: "agy-cli",
    provider: "agy",
    baseUrl: "local://agy",
    reasoning,
    ...(reasoning
      ? {
          thinkingLevelMap: Object.fromEntries(
            (["minimal", "low", "medium", "high", "xhigh", "max"] as const).map(
              (level) => [level, variants.includes(level) ? level : null],
            ),
          ),
        }
      : {}),
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 16_384,
  };
}

export function makeRuntime(
  env: E2EEnv,
  meta?: Map<string, AgyModelMeta>,
): StreamRuntime {
  return {
    config: env.config,
    getCwd: () => env.cwd,
    getMeta: (modelId) => meta?.get(modelId),
    store: new SessionStore(env.stateFile, env.bindingLockFile),
  };
}

export function userContext(...texts: string[]): Context {
  const messages = texts.map((text, i) => ({
    role: "user" as const,
    content: text,
    timestamp: i + 1,
  }));
  return {
    systemPrompt: "SYSTEM_PROMPT_MUST_NOT_LEAK",
    messages,
    tools: [
      {
        name: "bash",
        description: "TOOL_MUST_NOT_LEAK",
        parameters: { type: "object", properties: {} } as never,
      },
    ],
  };
}

export function multiTurnContext(
  pairs: Array<{ user: string; assistant?: string }>,
): Context {
  const messages: Context["messages"] = [];
  let ts = 1;
  for (const pair of pairs) {
    messages.push({ role: "user", content: pair.user, timestamp: ts++ });
    if (pair.assistant) {
      messages.push({
        role: "assistant",
        content: [{ type: "text", text: pair.assistant }],
        api: "agy-cli",
        provider: "agy",
        model: "m",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: ts++,
      });
    }
  }
  return {
    systemPrompt: "SYSTEM_PROMPT_MUST_NOT_LEAK",
    messages,
  };
}

export async function collectStream(
  stream: ReturnType<typeof streamAgy>,
): Promise<{ events: AssistantMessageEvent[]; message: AssistantMessage }> {
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  const message = await stream.result();
  return { events, message };
}

export function textOf(message: AssistantMessage): string {
  return message.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
}

export function promptArg(argv: string[]): string {
  const i = argv.indexOf("-p");
  return i >= 0 ? (argv[i + 1] ?? "") : "";
}
