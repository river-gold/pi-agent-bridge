import type { Model } from "@earendil-works/pi-ai";

const API = "cursor-acp";
const PROVIDER = "cursor";
const BASE_URL = "local://cursor-acp";

/**
 * Hardcoded catalog.
 * Pi model id → ACP session/set_config_option model value.
 */
export const HARDCODED_CURSOR_MODELS: Record<string, CursorModelInfo> = {
  auto: {
    name: "Auto",
    /** Exact value accepted by cursor-agent ACP. */
    acpModelValue: "default[]",
  },
};

export interface CursorModelInfo {
  name: string;
  acpModelValue: string;
}

export interface CursorModelMeta {
  acpModelValue: string;
}

export function toPiModels(
  catalog: Record<string, CursorModelInfo> = HARDCODED_CURSOR_MODELS,
): { models: Model<"cursor-acp">[]; meta: Map<string, CursorModelMeta> } {
  const models: Model<"cursor-acp">[] = [];
  const meta = new Map<string, CursorModelMeta>();

  for (const [id, info] of Object.entries(catalog)) {
    meta.set(id, { acpModelValue: info.acpModelValue });
    models.push({
      id,
      name: info.name,
      api: API,
      provider: PROVIDER,
      baseUrl: BASE_URL,
      reasoning: false,
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
  models: Model<"cursor-acp">[];
  meta: Map<string, CursorModelMeta>;
}> {
  return toPiModels(HARDCODED_CURSOR_MODELS);
}

export function resolveCursorModel(
  modelId: string,
  meta: CursorModelMeta | undefined,
): string {
  return meta?.acpModelValue || HARDCODED_CURSOR_MODELS[modelId]?.acpModelValue || "default[]";
}
