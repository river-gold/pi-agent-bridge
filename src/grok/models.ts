import type { Model, ThinkingLevelMap } from "@earendil-works/pi-ai";
import {
  loadModelsConfigFile,
  resolveAgentCatalog,
  type ConfigModelEntry,
} from "../shared/models-config.ts";

const API = "grok-acp";
const PROVIDER = "grok";
const BASE_URL = "local://grok-acp";

export interface GrokModelInfo {
  name: string;
  defaultEffort: string;
  efforts: string[];
  contextWindow?: number;
  maxTokens?: number;
}

export interface GrokModelMeta {
  defaultEffort: string;
  efforts: string[];
}

const NAMED_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;

export function buildThinkingLevelMap(efforts: string[]): ThinkingLevelMap {
  const set = new Set(efforts.map((v) => v.toLowerCase()));
  const map: ThinkingLevelMap = { off: null };
  for (const level of NAMED_LEVELS) {
    map[level] = set.has(level) ? level : null;
  }
  return map;
}

function mapConfigEntry(id: string, entry: ConfigModelEntry): GrokModelInfo {
  const efforts = entry.efforts ?? [];
  return {
    name: entry.name ?? id,
    defaultEffort: entry.defaultEffort ?? efforts[0] ?? "high",
    efforts,
    ...(entry.contextWindow ? { contextWindow: entry.contextWindow } : {}),
    ...(entry.maxTokens ? { maxTokens: entry.maxTokens } : {}),
  };
}

export function toPiModels(
  catalog: Record<string, GrokModelInfo> = {},
): { models: Model<"grok-acp">[]; meta: Map<string, GrokModelMeta> } {
  const models: Model<"grok-acp">[] = [];
  const meta = new Map<string, GrokModelMeta>();

  for (const [id, info] of Object.entries(catalog)) {
    const efforts = info.efforts ?? [];
    meta.set(id, {
      defaultEffort: info.defaultEffort ?? efforts[0] ?? "high",
      efforts,
    });

    models.push({
      id,
      name: info.name,
      api: API,
      provider: PROVIDER,
      baseUrl: BASE_URL,
      reasoning: efforts.length > 0,
      ...(efforts.length > 0
        ? { thinkingLevelMap: buildThinkingLevelMap(efforts) }
        : {}),
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: info.contextWindow ?? 500_000,
      maxTokens: info.maxTokens ?? 16_384,
    });
  }

  models.sort((a, b) => a.id.localeCompare(b.id));
  return { models, meta };
}

export async function loadGrokCatalog(configPath?: string): Promise<Record<string, GrokModelInfo>> {
  const { config } = await loadModelsConfigFile(configPath);
  return resolveAgentCatalog("grok", config, mapConfigEntry);
}

export async function discoverModels(opts?: {
  configPath?: string;
}): Promise<{
  models: Model<"grok-acp">[];
  meta: Map<string, GrokModelMeta>;
}> {
  const catalog = await loadGrokCatalog(opts?.configPath);
  return toPiModels(catalog);
}

export function resolveGrokConfig(
  modelId: string,
  reasoning: string | undefined,
  meta: GrokModelMeta | undefined,
): { model: string; effort: string } {
  const efforts = meta?.efforts ?? [];
  const map = buildThinkingLevelMap(efforts);
  const level = reasoning && reasoning !== "off" ? reasoning : undefined;
  const effort =
    (level ? map[level as keyof ThinkingLevelMap] : undefined) ||
    meta?.defaultEffort ||
    efforts[0] ||
    "high";

  return {
    model: modelId,
    effort: typeof effort === "string" ? effort : "high",
  };
}
