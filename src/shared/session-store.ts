import { open, readFile, rename, mkdir, stat, unlink, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

interface StoreEntry {
  conversationId: string | null;
  prevOutput: string;
}

interface StoreFile {
  sessions: Record<string, StoreEntry>;
}

interface LockPayload {
  token: string;
  pid: number;
}

interface LockIdentity {
  token: string;
  dev: number;
  ino: number;
}

export interface AcquireLockOptions {
  staleTimeoutMs?: number;
  isAlive?: (pid: number) => boolean;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
}

export const DEFAULT_STALE_TIMEOUT_MS = 30_000;
export const MAX_LOCK_ATTEMPTS = 10_000;

export function getAbortReason(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "string") return reason;
  return "The operation was aborted";
}

export function abortError(signal: AbortSignal): Error {
  const reason = signal.reason;
  const msg = getAbortReason(reason);
  const error = new Error(msg);
  error.name = "AbortError";
  if (reason instanceof Error && reason.stack) error.stack = reason.stack;
  return error;
}

export function timeoutError(): Error {
  const error = new Error("Timed out acquiring lock");
  error.name = "TimeoutError";
  return error;
}

export function throwIfCancelled(signal: AbortSignal | undefined, deadline: number | undefined): void {
  if (signal?.aborted) throw abortError(signal);
  if (deadline !== undefined && Date.now() >= deadline) throw timeoutError();
}

export function sleep(
  ms: number,
  signal: AbortSignal | undefined,
  deadline: number | undefined,
): Promise<void> {
  const delay = deadline === undefined ? ms : Math.min(ms, Math.max(0, deadline - Date.now()));
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(abortError(signal!));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    timer = setTimeout(() => {
      cleanup();
      if (deadline !== undefined && Date.now() >= deadline) reject(timeoutError());
      else resolve();
    }, delay);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function errCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code: unknown }).code;
  if (typeof code === "string") return code;
  return undefined;
}

export function defaultIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = errCode(error);
    if (code === "EPERM") return true;
    return false;
  }
}

export function parseLock(raw: string): LockPayload | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as LockPayload).token === "string" &&
      typeof (parsed as LockPayload).pid === "number"
    ) {
      return parsed as LockPayload;
    }
    return null;
  } catch {
    return null;
  }
}

export async function createLockFile(lockPath: string, token: string, openFn: (path: string, flags: string) => Promise<FileHandle> = open as any): Promise<LockIdentity | "exists"> {
  let fh: FileHandle;
  try {
    fh = await openFn(lockPath, "wx");
  } catch (error) {
    if (errCode(error) === "EEXIST") return "exists";
    throw error;
  }
  try {
    await fh.writeFile(JSON.stringify({ token, pid: process.pid }));
    const info = await fh.stat();
    await fh.close().catch(() => {});
    return { token, dev: info.dev, ino: info.ino };
  } catch (error) {
    await unlink(lockPath).catch(() => {});
    await fh.close().catch(() => {});
    throw error;
  }
}

export function isStale(mtimeMs: number, staleTimeoutMs: number): boolean {
  return Date.now() - mtimeMs >= staleTimeoutMs;
}

export async function maybeStealStaleLock(
  lockPath: string,
  staleTimeoutMs: number,
  isAlive: (pid: number) => boolean,
): Promise<void> {
  try {
    const parsed = parseLock(await readFile(lockPath, "utf-8"));
    if (parsed) {
      if (!isAlive(parsed.pid)) await unlink(lockPath);
      return;
    }
    const stats = await stat(lockPath);
    if (isStale(stats.mtimeMs, staleTimeoutMs)) await unlink(lockPath);
  } catch {
    return;
  }
}

export function releaseLock(lockPath: string, identity: LockIdentity): () => Promise<void> {
  return async () => {
    try {
      const pathStat = await stat(lockPath);
      if (pathStat.dev !== identity.dev || pathStat.ino !== identity.ino) return;
      const current = parseLock(await readFile(lockPath, "utf-8"));
      if (!current || current.token !== identity.token) return;
      await unlink(lockPath);
    } catch {
      return;
    }
  };
}

export async function tryAcquireLock(
  lockPath: string,
  options: AcquireLockOptions = {},
): Promise<(() => Promise<void>) | null> {
  const staleTimeoutMs = options.staleTimeoutMs ?? DEFAULT_STALE_TIMEOUT_MS;
  const isAlive = options.isAlive ?? defaultIsAlive;
  const token = randomUUID();

  await mkdir(dirname(lockPath), { recursive: true });

  const first = await createLockFile(lockPath, token);
  if (first !== "exists") return releaseLock(lockPath, first);

  await maybeStealStaleLock(lockPath, staleTimeoutMs, isAlive);

  const second = await createLockFile(lockPath, token);
  if (second === "exists") return null;
  return releaseLock(lockPath, second);
}

export async function acquireLock(
  lockPath: string,
  options: AcquireLockOptions = {},
  maxAttempts: number = MAX_LOCK_ATTEMPTS,
  tryAcquireLockFn: (path: string, opts: AcquireLockOptions) => Promise<(() => Promise<void>) | null> = tryAcquireLock,
): Promise<() => Promise<void>> {
  let backoff = 1;
  const maxBackoff = 500;
  const deadline = options.timeoutMs === undefined ? undefined : Date.now() + options.timeoutMs;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    throwIfCancelled(options.abortSignal, deadline);
    const got = await tryAcquireLockFn(lockPath, options);
    if (got) {
      try {
        throwIfCancelled(options.abortSignal, deadline);
      } catch (error) {
        await got();
        throw error;
      }
      return got;
    }
    await sleep(backoff, options.abortSignal, deadline);
    backoff = Math.min(backoff * 2, maxBackoff);
  }

  throw timeoutError();
}

export class SessionStore {
  private stateFile: string;
  private bindingLockFile: string;

  constructor(stateFile: string, bindingLockFile: string) {
    this.stateFile = stateFile;
    this.bindingLockFile = bindingLockFile;
  }

  acquireBindingLock(options: AcquireLockOptions = {}): Promise<() => Promise<void>> {
    return acquireLock(this.bindingLockFile, options);
  }

  async getEntry(sessionId: string): Promise<StoreEntry | null> {
    const store = await this.loadStore();
    return store.sessions[sessionId] ?? null;
  }

  async set(
    sessionId: string,
    conversationId: string | null,
    prevOutput: string = "",
  ): Promise<void> {
    await mkdir(dirname(this.stateFile), { recursive: true });
    const lockPath = this.stateFile + ".lock";
    const release = await acquireLock(lockPath);
    try {
      const store = await this.loadStoreUnlocked();
      store.sessions[sessionId] = { conversationId, prevOutput };
      const tmpPath = this.stateFile + ".tmp";
      await writeFile(tmpPath, JSON.stringify(store, null, 2), "utf-8");
      await rename(tmpPath, this.stateFile);
    } finally {
      await release();
    }
  }

  private async loadStore(): Promise<StoreFile> {
    await mkdir(dirname(this.stateFile), { recursive: true });
    const lockPath = this.stateFile + ".lock";
    const release = await acquireLock(lockPath);
    try {
      return await this.loadStoreUnlocked();
    } finally {
      await release();
    }
  }

  private async loadStoreUnlocked(): Promise<StoreFile> {
    let raw: string;
    try {
      raw = await readFile(this.stateFile, "utf-8");
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return { sessions: {} };
      throw err;
    }

    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed) ||
      typeof (parsed as { sessions?: unknown }).sessions !== "object" ||
      (parsed as { sessions?: unknown }).sessions === null ||
      Array.isArray((parsed as { sessions?: unknown }).sessions)
    ) {
      throw new Error("Invalid session store state format");
    }

    return { sessions: (parsed as StoreFile).sessions };
  }
}
