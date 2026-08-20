import { homedir } from "node:os";
import { join } from "node:path";

export interface CursorConfig {
  /** Command used to spawn the ACP agent (default: cursor-agent). */
  command: string;
  /** Args for the ACP agent (default: acp). */
  args: string[];
  timeoutMs: number;
  /** ACP session mode: agent | plan | ask */
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

export function loadCursorConfig(overrides?: Partial<CursorConfig>): CursorConfig {
  const stateDir = join(homedir(), ".pi", "agent", "cursor");
  return {
    command: process.env.CURSOR_ACP_COMMAND?.trim() || "cursor-agent",
    args: envList("CURSOR_ACP_ARGS") ?? ["acp"],
    timeoutMs: envInt("CURSOR_ACP_TIMEOUT_MS", 300_000),
    mode: process.env.CURSOR_ACP_MODE?.trim() || "agent",
    stateFile: join(stateDir, "sessions.json"),
    bindingLockFile: join(stateDir, "binding.lock"),
    ...overrides,
  };
}
