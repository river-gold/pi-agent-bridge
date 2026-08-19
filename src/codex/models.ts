import type { Model, ThinkingLevelMap } from "@earendil-works/pi-ai";

const API = "codex-acp";
const PROVIDER = "codex";
const BASE_URL = "local://codex-acp";

/** Hardcoded catalog. Edit here to change exposed models / efforts. */
export const HARDCODED_CODEX_MODELS: Record<string, CodexModelInfo> = {
  "gpt-5.6-sol": {
    name: "GPT-5.6 Sol",
    defaultEffort: "high",
    efforts: ["low", "medium", "high", "xhigh", "max"],
  },
  "gpt-5.6-terra": {
    name: "GPT-5.6 Terra",
    defaultEffort: "high",
    efforts: ["low", "medium", "high", "xhigh", "max"],
  },
  "gpt-5.6-luna": {
    name: "GPT-5.6 Luna",
    defaultEffort: "high",
    efforts: ["low", "medium", "high", "xhigh", "max"],
  },
};

export interface CodexModelInfo {
  name: string;
  defaultEffort: string;
  efforts: string[];
}

export interface CodexModelMeta {
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
  catalog: Record<string, CodexModelInfo> = HARDCODED_CODEX_MODELS,
): { models: Model<"codex-acp">[]; meta: Map<string, CodexModelMeta> } {
  const models: Model<"codex-acp">[] = [];
  const meta = new Map<string, CodexModelMeta>();

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
      contextWindow: 200_000,
      maxTokens: 16_384,
    });
  }

  models.sort((a, b) => a.id.localeCompare(b.id));
  return { models, meta };
}

export async function discoverModels(): Promise<{
  models: Model<"codex-acp">[];
  meta: Map<string, CodexModelMeta>;
}> {
  return toPiModels(HARDCODED_CODEX_MODELS);
}

/**
 * Resolve ACP model id + optional reasoning_effort.
 * Effort is omitted only when the catalog has no efforts (not used currently).
 */
export function resolveCodexConfig(
  modelId: string,
  reasoning: string | undefined,
  meta: CodexModelMeta | undefined,
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
