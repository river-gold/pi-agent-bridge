import { homedir } from "node:os";
import { join } from "node:path";

export interface GrokConfig {
  /** Command used to spawn the ACP agent (default: grok). */
  command: string;
  /** Args for the ACP agent (default: agent --always-approve stdio). */
  args: string[];
  timeoutMs: number;
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

export function loadGrokConfig(overrides?: Partial<GrokConfig>): GrokConfig {
  const stateDir = join(homedir(), ".pi", "agent", "grok");
  return {
    command: process.env.GROK_ACP_COMMAND?.trim() || "grok",
    args: envList("GROK_ACP_ARGS") ?? ["agent", "--always-approve", "stdio"],
    timeoutMs: envInt("GROK_ACP_TIMEOUT_MS", 300_000),
    stateFile: join(stateDir, "sessions.json"),
    bindingLockFile: join(stateDir, "binding.lock"),
    ...overrides,
  };
}
