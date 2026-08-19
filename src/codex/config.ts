import { homedir } from "node:os";
import { join } from "node:path";

export interface CodexConfig {
  /** Command used to spawn the ACP agent (default: npx). */
  command: string;
  /** Args for the ACP agent (default: -y @agentclientprotocol/codex-acp@1.6.0). */
  args: string[];
  timeoutMs: number;
  /** ACP session mode: read-only | agent | agent-full-access */
  mode: string;
  stateFile: string;
  bindingLockFile: string;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function envList(name: string): string[] | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  return raw.split(/\s+/).filter(Boolean);
}

export function loadCodexConfig(overrides?: Partial<CodexConfig>): CodexConfig {
  const stateDir = join(homedir(), ".pi", "agent", "codex");
  return {
    command: process.env.CODEX_ACP_COMMAND?.trim() || "npx",
    args: envList("CODEX_ACP_ARGS") ?? [
      "-y",
      "@agentclientprotocol/codex-acp@1.6.0",
    ],
    timeoutMs: envInt("CODEX_ACP_TIMEOUT_MS", 300_000),
    mode: process.env.CODEX_ACP_MODE?.trim() || "agent-full-access",
    stateFile: join(stateDir, "sessions.json"),
    bindingLockFile: join(stateDir, "binding.lock"),
    ...overrides,
  };
}
