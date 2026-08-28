import { homedir } from "node:os";
import { join } from "node:path";

export interface AntigravityConfig {
  binary: string;
  timeoutMs: number;
  extraArgs: string[];
  conversationsDir: string;
  stateFile: string;
  modelCacheFile: string;
  bindingLockFile: string;
}

export type AgyConfig = AntigravityConfig;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function envList(name: string): string[] {
  const raw = process.env[name]?.trim();
  if (!raw) return [];
  return raw.split(/\s+/).filter(Boolean);
}

export function loadConfig(overrides?: Partial<AntigravityConfig>): AntigravityConfig {
  const stateDir = join(homedir(), ".pi", "agent", "antigravity");
  const cacheDir = join(homedir(), ".cache", "pi-agent-bridge");
  const extraArgs =
    envList("ANTIGRAVITY_EXTRA_ARGS").length > 0
      ? envList("ANTIGRAVITY_EXTRA_ARGS")
      : envList("AGY_EXTRA_ARGS");

  return {
    binary:
      process.env.ANTIGRAVITY_BINARY?.trim() ||
      process.env.AGY_BINARY?.trim() ||
      "agy",
    timeoutMs: envInt(
      "ANTIGRAVITY_TIMEOUT_MS",
      envInt("AGY_TIMEOUT_MS", 300_000),
    ),
    extraArgs,
    conversationsDir:
      process.env.ANTIGRAVITY_CONVERSATIONS_DIR?.trim() ||
      process.env.AGY_CONVERSATIONS_DIR?.trim() ||
      join(homedir(), ".gemini", "antigravity-cli", "conversations"),
    stateFile: join(stateDir, "sessions.json"),
    modelCacheFile: join(cacheDir, "models.json"),
    bindingLockFile: join(stateDir, "binding.lock"),
    ...overrides,
  };
}
