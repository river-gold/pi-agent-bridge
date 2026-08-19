import type { Model, ThinkingLevelMap } from "@earendil-works/pi-ai";

const API = "grok-acp";
const PROVIDER = "grok";
const BASE_URL = "local://grok-acp";

const EFFORTS = ["low", "medium", "high", "xhigh"] as const;

/** Hardcoded catalog. Edit here to change exposed models / efforts. */
export const HARDCODED_GROK_MODELS: Record<string, GrokModelInfo> = {
  "grok-4.6": {
    name: "Grok 4.6",
    defaultEffort: "high",
    efforts: [...EFFORTS],
  },
};

export interface GrokModelInfo {
  name: string;
  defaultEffort: string;
  efforts: string[];
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

export function toPiModels(
  catalog: Record<string, GrokModelInfo> = HARDCODED_GROK_MODELS,
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
      contextWindow: 500_000,
      maxTokens: 16_384,
    });
  }

  models.sort((a, b) => a.id.localeCompare(b.id));
  return { models, meta };
}

export async function discoverModels(): Promise<{
  models: Model<"grok-acp">[];
  meta: Map<string, GrokModelMeta>;
}> {
  return toPiModels(HARDCODED_GROK_MODELS);
}

/** Resolve ACP model id + reasoning effort (sent via session/set_mode). */
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
