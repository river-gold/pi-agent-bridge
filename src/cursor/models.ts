import type { Model, ThinkingLevelMap } from "@earendil-works/pi-ai";
import {
  loadModelsConfigFile,
  resolveAgentCatalog,
  type ConfigModelEntry,
} from "../shared/models-config.ts";

const API = "cursor-acp";
const PROVIDER = "cursor";
const BASE_URL = "local://cursor-acp";

const NAMED_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;

export interface CursorModelInfo {
  name: string;
  /** Base ACP model value (Pi id if omitted in config). */
  acpModelValue: string;
  defaultEffort?: string;
  efforts?: string[];
  contextWindow?: number;
  maxTokens?: number;
}

export interface CursorModelMeta {
  acpModelValue: string;
  defaultEffort?: string;
  efforts: string[];
}

export function buildThinkingLevelMap(efforts: string[]): ThinkingLevelMap {
  const set = new Set(efforts.map((v) => v.toLowerCase()));
  const map: ThinkingLevelMap = { off: null };
  for (const level of NAMED_LEVELS) {
    map[level] = set.has(level) ? level : null;
  }
  return map;
}

/**
 * Merge effort into Cursor model value.
 * - `composer-2.5` + high → `composer-2.5[effort=high]`
 * - `default[]` + high → `default[effort=high]`
 * - `foo[fast=true]` + high → `foo[fast=true,effort=high]`
 * - `foo[effort=low]` + high → `foo[effort=high]`
 */
export function withEffortParam(base: string, effort: string): string {
  const trimmed = base.trim();
  const open = trimmed.indexOf("[");
  if (open < 0 || !trimmed.endsWith("]")) {
    return `${trimmed}[effort=${effort}]`;
  }
  const name = trimmed.slice(0, open);
  const inner = trimmed.slice(open + 1, -1).trim();
  if (!inner) return `${name}[effort=${effort}]`;

  const parts = inner
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !/^effort=/i.test(p));
  parts.push(`effort=${effort}`);
  return `${name}[${parts.join(",")}]`;
}

function mapConfigEntry(id: string, entry: ConfigModelEntry): CursorModelInfo {
  const efforts = entry.efforts ?? [];
  return {
    name: entry.name ?? id,
    acpModelValue: entry.acpModelValue ?? id,
    ...(efforts.length > 0
      ? {
          efforts,
          defaultEffort: entry.defaultEffort ?? efforts[0] ?? "high",
        }
      : {}),
    ...(entry.contextWindow ? { contextWindow: entry.contextWindow } : {}),
    ...(entry.maxTokens ? { maxTokens: entry.maxTokens } : {}),
  };
}

export function toPiModels(
  catalog: Record<string, CursorModelInfo> = {},
): { models: Model<"cursor-acp">[]; meta: Map<string, CursorModelMeta> } {
  const models: Model<"cursor-acp">[] = [];
  const meta = new Map<string, CursorModelMeta>();

  for (const [id, info] of Object.entries(catalog)) {
    const efforts = info.efforts ?? [];
    meta.set(id, {
      acpModelValue: info.acpModelValue,
      efforts,
      ...(efforts.length > 0
        ? { defaultEffort: info.defaultEffort ?? efforts[0] ?? "high" }
        : {}),
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
      contextWindow: info.contextWindow ?? 200_000,
      maxTokens: info.maxTokens ?? 16_384,
    });
  }

  models.sort((a, b) => a.id.localeCompare(b.id));
  return { models, meta };
}

export async function loadCursorCatalog(configPath?: string): Promise<Record<string, CursorModelInfo>> {
  const { config } = await loadModelsConfigFile(configPath);
  return resolveAgentCatalog("cursor", config, mapConfigEntry);
}

export async function discoverModels(opts?: {
  configPath?: string;
}): Promise<{
  models: Model<"cursor-acp">[];
  meta: Map<string, CursorModelMeta>;
}> {
  const catalog = await loadCursorCatalog(opts?.configPath);
  return toPiModels(catalog);
}

/**
 * Resolve ACP model value.
 * With efforts configured: base[effort=...].
 * Without efforts: base as-is (e.g. default[]).
 */
export function resolveCursorModel(
  modelId: string,
  reasoning: string | undefined,
  meta: CursorModelMeta | undefined,
): string {
  const base = meta?.acpModelValue || modelId || "default[]";
  const efforts = meta?.efforts ?? [];
  if (efforts.length === 0) return base;

  const map = buildThinkingLevelMap(efforts);
  const level = reasoning && reasoning !== "off" ? reasoning : undefined;
  const effort =
    (level ? map[level as keyof ThinkingLevelMap] : undefined) ||
    meta?.defaultEffort ||
    efforts[0] ||
    "high";
  if (typeof effort !== "string" || !effort) return base;
  return withEffortParam(base, effort);
}
