import { homedir } from "node:os";
import { join } from "node:path";

export interface AgyConfig {
	binary: string;
	timeoutMs: number;
	extraArgs: string[];
	conversationsDir: string;
	stateFile: string;
	modelCacheFile: string;
	bindingLockFile: string;
}

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

export function loadConfig(overrides?: Partial<AgyConfig>): AgyConfig {
	const stateDir = join(homedir(), ".pi", "agent", "agy");
	const cacheDir = join(homedir(), ".cache", "pi-agent-bridge");
	return {
		binary: process.env.AGY_BINARY?.trim() || "agy",
		timeoutMs: envInt("AGY_TIMEOUT_MS", 300_000),
		extraArgs: envList("AGY_EXTRA_ARGS"),
		conversationsDir:
			process.env.AGY_CONVERSATIONS_DIR?.trim() ||
			join(homedir(), ".gemini", "antigravity-cli", "conversations"),
		stateFile: join(stateDir, "sessions.json"),
		modelCacheFile: join(cacheDir, "models.json"),
		bindingLockFile: join(stateDir, "binding.lock"),
		...overrides,
	};
}
