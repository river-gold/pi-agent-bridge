import type { Model, ThinkingLevelMap } from "@earendil-works/pi-ai";

const AGY_API = "agy-cli";
const AGY_PROVIDER = "agy";
const AGY_BASE_URL = "local://agy";

/** Hardcoded catalog. Edit here to change exposed models / efforts. */
export const HARDCODED_AGY_MODELS: Record<string, DiscoveredAgyModel> = {
  "gemini-3.7-flash": {
    name: "Gemini 3.7 Flash",
    defaultVariant: "high",
    variants: ["high", "medium", "low"],
  },
};

export interface DiscoveredAgyModel {
  name: string;
  defaultVariant?: string;
  variants?: string[];
}

export interface AgyModelMeta {
  defaultVariant?: string;
  variants: string[];
}

/** Pi thinking levels that share a name with agy model suffixes. */
const NAMED_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;

/**
 * Map only suffixes that match a Pi thinking level name.
 * Unsupported levels stay null so the UI does not offer them.
 */
export function buildThinkingLevelMap(variants: string[]): ThinkingLevelMap {
  const set = new Set(variants.map((v) => v.toLowerCase()));
  const map: ThinkingLevelMap = { off: null };
  for (const level of NAMED_LEVELS) {
    map[level] = set.has(level) ? level : null;
  }
  return map;
}

export function toPiModels(
  discovered: Record<string, DiscoveredAgyModel> = HARDCODED_AGY_MODELS,
): { models: Model<"agy-cli">[]; meta: Map<string, AgyModelMeta> } {
  const models: Model<"agy-cli">[] = [];
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
      contextWindow: 200_000,
      maxTokens: 16_384,
    });
  }

  models.sort((a, b) => a.id.localeCompare(b.id));
  return { models, meta };
}

/** Always returns the hardcoded catalog (no `agy models` discovery). */
export async function discoverModels(_opts?: {
  binary?: string;
  cacheFile?: string;
  now?: number;
  ttlMs?: number;
  force?: boolean;
}): Promise<{ models: Model<"agy-cli">[]; meta: Map<string, AgyModelMeta> }> {
  return toPiModels(HARDCODED_AGY_MODELS);
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
    // agy exposes effort as model id suffix: gemini-3.7-flash-high
    return { model: `${modelId}-${variant}` };
  }
  return { model: modelId };
}
