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
  modelId: string;
  name: string;
  defaultVariant?: string;
  variants?: string[];
  contextWindow?: number;
  maxTokens?: number;
}

export interface AgyModelMeta {
  modelId: string;
  defaultVariant?: string;
  variants: string[];
}

const NAMED_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;

type ThinkingLevel = (typeof NAMED_LEVELS)[number];
type ModelThinkingLevel = ThinkingLevel | "off";

function isThinkingLevel(value: string): value is ModelThinkingLevel {
  return (NAMED_LEVELS as readonly string[]).includes(value) || value === "off";
}

export function buildThinkingLevelMap(variants: string[]): ThinkingLevelMap {
  const set = new Set(variants.map((v) => v.toLowerCase()));
  const map: ThinkingLevelMap = { off: null };
  for (const level of NAMED_LEVELS) {
    map[level] = set.has(level) ? level : null;
  }
  return map;
}

export function mapConfigEntry(id: string, entry: ConfigModelEntry): DiscoveredAgyModel {
  const variants = entry.variants ?? [];
  const result: DiscoveredAgyModel = {
    modelId: entry.modelId,
    name: entry.name ?? id,
    defaultVariant: entry.defaultVariant ?? variants[0],
    variants,
  };
  if (entry.contextWindow) result.contextWindow = entry.contextWindow;
  if (entry.maxTokens) result.maxTokens = entry.maxTokens;
  return result;
}

export function toPiModels(discovered: Record<string, DiscoveredAgyModel> = {}): {
  models: Model<"openai-completions">[];
  meta: Map<string, AgyModelMeta>;
} {
  const models: Model<"openai-completions">[] = [];
  const meta = new Map<string, AgyModelMeta>();

  for (const [id, info] of Object.entries(discovered)) {
    const rawVariants = info.variants ?? [];
    const defaultVariant = info.defaultVariant ?? rawVariants[0];
    const variants = rawVariants.length > 0 ? rawVariants : defaultVariant ? [defaultVariant] : [];
    const hasVariants = variants.length >= 1;
    meta.set(id, {
      modelId: info.modelId,
      defaultVariant,
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

  const sorted = models.toSorted((a, b) => a.id.localeCompare(b.id));
  return { models: sorted, meta };
}

export async function loadAgyCatalog(
  configPath?: string,
): Promise<Record<string, DiscoveredAgyModel>> {
  const { config } = await loadModelsConfigFile(configPath);
  // Prefer "antigravity" key, fallback to legacy "agy" for migration
  const primary = resolveAgentCatalog("antigravity", config, mapConfigEntry);
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
  piModelId: string,
  reasoning: string | undefined,
  meta: AgyModelMeta | undefined,
): { model: string; effort?: string } {
  const base = meta?.modelId ?? piModelId;
  const variants = meta?.variants ?? [];
  const defaultVariant = meta?.defaultVariant ?? variants[0];
  if (!meta || (variants.length === 0 && !defaultVariant)) {
    return { model: base };
  }

  const effectiveVariants = variants.length > 0 ? variants : defaultVariant ? [defaultVariant] : [];
  const map = buildThinkingLevelMap(effectiveVariants);
  const level = reasoning && reasoning !== "off" ? reasoning : undefined;
  const variant =
    (level && isThinkingLevel(level) ? map[level] : undefined) ||
    defaultVariant ||
    effectiveVariants[0];

  if (typeof variant === "string" && variant.length > 0) {
    return { model: `${base}-${variant}` };
  }
  return { model: base };
}
