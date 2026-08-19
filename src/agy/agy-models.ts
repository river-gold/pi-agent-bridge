import { spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Model, ThinkingLevelMap } from "@earendil-works/pi-ai";

const MODEL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MODEL_CACHE_VERSION = 1;
const AGY_API = "agy-cli";
const AGY_PROVIDER = "agy";
const AGY_BASE_URL = "local://agy";

export interface DiscoveredAgyModel {
  name: string;
  defaultVariant?: string;
  variants?: string[];
}

export interface ModelCacheFile {
  version?: number;
  binary: string;
  fetchedAt: number;
  models: Record<string, DiscoveredAgyModel>;
}

export interface AgyModelMeta {
  defaultVariant?: string;
  variants: string[];
}

function splitLastHyphen(id: string): { base: string; suffix: string } | null {
  const i = id.lastIndexOf("-");
  if (i <= 0 || i === id.length - 1) return null;
  return { base: id.slice(0, i), suffix: id.slice(i + 1) };
}

function stripSuffixLabel(label: string, suffix: string): string {
  const end = `(${suffix})`;
  if (label.toLowerCase().endsWith(end.toLowerCase())) {
    return label.slice(0, label.length - end.length).trim();
  }
  return label;
}

export function parseAgyModels(output: string): Record<string, DiscoveredAgyModel> {
  const rows: { id: string; label: string }[] = [];
  const lines = output.split("\n");

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("Fetching")) continue;

    const tab = line.indexOf("\t");
    const id = (tab >= 0 ? line.slice(0, tab) : line.split(/\s{2,}/)[0] ?? "").trim();
    const label = (tab >= 0 ? line.slice(tab + 1) : line.split(/\s{2,}/)[1] ?? id).trim();
    if (!id) continue;
    rows.push({ id, label: label || id });
  }

  const baseCount = new Map<string, number>();
  for (const row of rows) {
    const split = splitLastHyphen(row.id);
    if (!split) continue;
    baseCount.set(split.base, (baseCount.get(split.base) ?? 0) + 1);
  }

  const models: Record<string, DiscoveredAgyModel> = {};

  for (const row of rows) {
    const split = splitLastHyphen(row.id);
    if (split && (baseCount.get(split.base) ?? 0) >= 2) {
      const existing = models[split.base] ?? {
        name: stripSuffixLabel(row.label, split.suffix),
        variants: [],
      };
      existing.defaultVariant ??= split.suffix;
      existing.variants ??= [];
      if (!existing.variants.includes(split.suffix)) {
        existing.variants.push(split.suffix);
      }
      models[split.base] = existing;
      continue;
    }

    const existing = models[row.id];
    if (existing?.variants?.length) {
      existing.name = row.label;
    } else {
      models[row.id] = { name: row.label };
    }
  }

  return models;
}

export function isModelCacheFresh(
  cache: ModelCacheFile | null,
  now: number,
  ttlMs = MODEL_CACHE_TTL_MS,
): boolean {
  return Boolean(cache && now - cache.fetchedAt <= ttlMs);
}

export async function loadModelCache(path: string): Promise<ModelCacheFile | null> {
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as ModelCacheFile;
    if (
      !parsed ||
      parsed.version !== MODEL_CACHE_VERSION ||
      typeof parsed.fetchedAt !== "number" ||
      !parsed.models
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function saveModelCache(path: string, cache: ModelCacheFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = path + ".tmp";
  await writeFile(tmpPath, JSON.stringify({ ...cache, version: MODEL_CACHE_VERSION }), "utf-8");
  await rename(tmpPath, path);
}

export function listAgyModels(binary = "agy"): Promise<Record<string, DiscoveredAgyModel>> {
  return new Promise((resolve) => {
    const child = spawn(binary, ["models"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));

    const finish = (models: Record<string, DiscoveredAgyModel>) => {
      clearTimeout(timer);
      resolve(models);
    };

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish({});
    }, 15_000);

    child.on("close", (code) => {
      if (code !== 0) {
        finish({});
        return;
      }
      finish(parseAgyModels(Buffer.concat(chunks).toString("utf-8")));
    });

    child.on("error", () => finish({}));
  });
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
  discovered: Record<string, DiscoveredAgyModel>,
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

export async function discoverModels(opts: {
  binary: string;
  cacheFile: string;
  now?: number;
  ttlMs?: number;
  /** When true, always re-list and ignore cache freshness. */
  force?: boolean;
  list?: (binary: string) => Promise<Record<string, DiscoveredAgyModel>>;
}): Promise<{ models: Model<"agy-cli">[]; meta: Map<string, AgyModelMeta> }> {
  const now = opts.now ?? Date.now();
  const ttlMs = opts.ttlMs ?? MODEL_CACHE_TTL_MS;
  const list = opts.list ?? listAgyModels;
  const cache = await loadModelCache(opts.cacheFile);
  const usable = cache && cache.binary === opts.binary ? cache : null;

  if (!opts.force && usable && Object.keys(usable.models).length > 0) {
    const result = toPiModels(usable.models);
    if (!isModelCacheFresh(usable, now, ttlMs)) {
      void list(opts.binary)
        .then(async (models) => {
          if (Object.keys(models).length === 0) return;
          await saveModelCache(opts.cacheFile, {
            binary: opts.binary,
            fetchedAt: Date.now(),
            models,
          });
        })
        .catch(() => undefined);
    }
    return result;
  }

  const discovered = await list(opts.binary);
  if (Object.keys(discovered).length === 0) {
    if (usable && Object.keys(usable.models).length > 0) {
      return toPiModels(usable.models);
    }
    return { models: [], meta: new Map() };
  }
  await saveModelCache(opts.cacheFile, {
    binary: opts.binary,
    fetchedAt: now,
    models: discovered,
  });
  return toPiModels(discovered);
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
