import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse, type ParseError } from "jsonc-parser";

/** Per-agent model entry shape used in the project model config. */
export interface ConfigModelEntry {
  /** agy model id (e.g. "gemini-3.8-flash") */
  modelId: string;
  name?: string;
  /** agy: suffix variants (high/medium/low) */
  variants?: string[];
  defaultVariant?: string;
  contextWindow?: number;
  maxTokens?: number;
}

export type AgentModelCatalog = Record<string, ConfigModelEntry>;

export interface ModelsConfigFile {
  agy?: { models?: AgentModelCatalog };
  antigravity?: { models?: AgentModelCatalog };
}

export type AgentKey = keyof ModelsConfigFile;

/** Default: `.pi/agent/pi-agent-bridge.jsonc` under Pi's startup cwd. */
export function defaultModelsConfigPath(): string {
  return join(process.cwd(), ".pi", "agent", "pi-agent-bridge.jsonc");
}

export function resolveModelsConfigPath(override?: string): string {
  const fromEnv = process.env.PI_AGENT_BRIDGE_CONFIG?.trim();
  return override?.trim() || fromEnv || defaultModelsConfigPath();
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  return out.length > 0 ? out : undefined;
}

export function parseModelEntry(raw: unknown, id: string): ConfigModelEntry | null {
  if (!isPlainObject(raw)) return null;
  const modelId = typeof raw.modelId === "string" ? raw.modelId.trim() : "";
  if (!modelId) return null;
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : id;
  const entry: ConfigModelEntry = { modelId, name };
  const variants = asStringArray(raw.variants);
  if (variants) entry.variants = variants;
  if (typeof raw.defaultVariant === "string" && raw.defaultVariant.trim()) {
    entry.defaultVariant = raw.defaultVariant.trim();
  }
  if (
    typeof raw.contextWindow === "number" &&
    Number.isFinite(raw.contextWindow) &&
    raw.contextWindow > 0
  ) {
    entry.contextWindow = Math.floor(raw.contextWindow);
  }
  if (typeof raw.maxTokens === "number" && Number.isFinite(raw.maxTokens) && raw.maxTokens > 0) {
    entry.maxTokens = Math.floor(raw.maxTokens);
  }
  return entry;
}

export function parseAgentSection(raw: unknown): AgentModelCatalog | undefined {
  if (!isPlainObject(raw)) return undefined;
  if (!("models" in raw)) return undefined;
  const modelsRaw = raw.models;
  if (!isPlainObject(modelsRaw)) return {};
  const out: AgentModelCatalog = {};
  for (const [id, value] of Object.entries(modelsRaw)) {
    const key = id.trim();
    if (!key) continue;
    const entry = parseModelEntry(value, key);
    if (entry) out[key] = entry;
  }
  return out;
}

/** Parse the model config body. Invalid agent sections are ignored. */
export function parseModelsConfig(raw: unknown): ModelsConfigFile {
  if (!isPlainObject(raw)) return {};
  const out: ModelsConfigFile = {};
  for (const agent of ["agy", "antigravity"] as const) {
    if (!(agent in raw)) continue;
    const models = parseAgentSection(raw[agent]);
    if (models !== undefined) out[agent] = { models };
  }
  return out;
}

interface LoadedModelsConfig {
  path: string;
  config: ModelsConfigFile;
  exists: boolean;
}

export async function readModelsConfigFile(
  configPath: string,
  readFileFn: typeof readFile = readFile,
): Promise<LoadedModelsConfig> {
  let text: string;
  try {
    text = await readFileFn(configPath, "utf-8");
  } catch (error: unknown) {
    const code = isPlainObject(error) && "code" in error ? error.code : undefined;
    if (code === "ENOENT") return { path: configPath, config: {}, exists: false };
    throw error;
  }

  const errors: ParseError[] = [];
  const parsed = parse(text, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  }) as unknown;
  if (errors.length > 0) {
    throw new Error(`Invalid JSONC in models config ${configPath}: ${errors[0].error}`);
  }
  return { path: configPath, config: parseModelsConfig(parsed), exists: true };
}

export async function loadModelsConfigFile(path?: string): Promise<LoadedModelsConfig> {
  const overridePath = path?.trim();
  const envPath = process.env.PI_AGENT_BRIDGE_CONFIG?.trim();
  const configPath = overridePath || envPath;
  if (configPath) return readModelsConfigFile(configPath);

  const projectPath = defaultModelsConfigPath();
  const projectConfig = await readModelsConfigFile(projectPath);
  if (projectConfig.exists) return projectConfig;

  const homePath = join(homedir(), ".pi", "agent", "pi-agent-bridge.jsonc");
  if (homePath === projectPath) return projectConfig;

  const homeConfig = await readModelsConfigFile(homePath);
  return homeConfig.exists ? homeConfig : projectConfig;
}

/**
 * Resolve catalog for one agent from config only.
 * Missing section / missing file → empty catalog.
 */
export function resolveAgentCatalog<T>(
  agent: AgentKey,
  config: ModelsConfigFile,
  mapEntry: (id: string, entry: ConfigModelEntry) => T,
): Record<string, T> {
  const section = config[agent];
  if (!section || section.models === undefined) return {};

  const out: Record<string, T> = {};
  for (const [id, entry] of Object.entries(section.models)) {
    out[id] = mapEntry(id, entry);
  }
  return out;
}
