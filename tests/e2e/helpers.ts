import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, type AgyConfig } from "../../src/agy/config.ts";
import { SessionStore } from "../../src/agy/session-store.ts";

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
