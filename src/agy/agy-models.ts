import type { Model, ThinkingLevelMap } from "@earendil-works/pi-ai";
import {
  loadModelsConfigFile,
  resolveAgentCatalog,
  type ConfigModelEntry,
} from "../shared/models-config.ts";

const AGY_API = "openai-completions";
const AGY_PROVIDER = "antigravity";
const AGY_BASE_URL = "pi-agent-bridge://antigravity";

export interface DiscoveredAgyModel {
  name: string;
  defaultVariant?: string;
  variants?: string[];
  contextWindow?: number;
  maxTokens?: number;
}

export interface AgyModelMeta {
  defaultVariant?: string;
  variants: string[];
}

const NAMED_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;

export function buildThinkingLevelMap(variants: string[]): ThinkingLevelMap {
  const set = new Set(variants.map((v) => v.toLowerCase()));
  const map: ThinkingLevelMap = { off: null };
  for (const level of NAMED_LEVELS) {
    map[level] = set.has(level) ? level : null;
  }
  return map;
}

function mapConfigEntry(id: string, entry: ConfigModelEntry): DiscoveredAgyModel {
  const variants = entry.variants ?? [];
  return {
    name: entry.name ?? id,
    defaultVariant: entry.defaultVariant ?? variants[0],
    variants,
    ...(entry.contextWindow ? { contextWindow: entry.contextWindow } : {}),
    ...(entry.maxTokens ? { maxTokens: entry.maxTokens } : {}),
  };
}

export function toPiModels(discovered: Record<string, DiscoveredAgyModel> = {}): {
  models: Model<"openai-completions">[];
  meta: Map<string, AgyModelMeta>;
} {
  const models: Model<"openai-completions">[] = [];
  const meta = new Map<string, AgyModelMeta>();

  for (const [id, info] of Object.entries(discovered)) {
    const variants = info.variants ?? [];
    const hasVariants = variants.length >= 2;
    meta.set(id, {
      defaultVariant: info.defaultVariant ?? variants[0],
      variants,
    });

    models.push({
      id,
      name: info.name,
      api: AGY_API,
      provider: AGY_PROVIDER,
      baseUrl: AGY_BASE_URL,
      reasoning: hasVariants,
      ...(hasVariants ? { thinkingLevelMap: buildThinkingLevelMap(variants) } : {}),
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: info.contextWindow ?? 200_000,
      maxTokens: info.maxTokens ?? 16_384,
    });
  }

  models.sort((a, b) => a.id.localeCompare(b.id));
  return { models, meta };
}

export async function loadAgyCatalog(
  configPath?: string,
): Promise<Record<string, DiscoveredAgyModel>> {
  const { config } = await loadModelsConfigFile(configPath);
  // Prefer "antigravity" key, fallback to legacy "agy" for migration
  const primary = resolveAgentCatalog("antigravity" as any, config, mapConfigEntry);
  if (Object.keys(primary).length > 0) return primary;
  return resolveAgentCatalog("agy", config, mapConfigEntry);
}

export async function discoverModels(opts?: {
  binary?: string;
  cacheFile?: string;
  now?: number;
  ttlMs?: number;
  force?: boolean;
  configPath?: string;
}): Promise<{
  models: Model<"openai-completions">[];
  meta: Map<string, AgyModelMeta>;
}> {
  const catalog = await loadAgyCatalog(opts?.configPath);
  return toPiModels(catalog);
}

export function resolveAgyModelId(
  modelId: string,
  reasoning: string | undefined,
  meta: AgyModelMeta | undefined,
): { model: string; effort?: string } {
  if (!meta || meta.variants.length < 2) {
    return { model: modelId };
  }

  const map = buildThinkingLevelMap(meta.variants);
  const level = reasoning && reasoning !== "off" ? reasoning : undefined;
  const variant =
    (level ? map[level as keyof ThinkingLevelMap] : undefined) ||
    meta.defaultVariant ||
    meta.variants[0];

  if (typeof variant === "string" && variant.length > 0) {
    return { model: `${modelId}-${variant}` };
  }
  return { model: modelId };
}
