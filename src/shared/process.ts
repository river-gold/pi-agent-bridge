import type { ChildProcess } from "node:child_process";

function destroyStream(stream: { destroy: () => void } | undefined | null): void {
  if (!stream) return;
  try {
    stream.destroy();
  } catch {
    // ignore
  }
}

export function isAlreadyExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

/** Close stdio and SIGKILL so the Node event loop can exit. */
export async function disposeChild(child: ChildProcess | null): Promise<void> {
  if (!child) return;
  destroyStream(child.stdin);
  destroyStream(child.stdout);
  destroyStream(child.stderr);
  if (isAlreadyExited(child)) return;

  await new Promise<void>((resolve) => {
    const finish = () => resolve();
    child.once("exit", finish);
    if (!tryKill(child, "SIGKILL")) {
      finish();
      return;
    }
    setTimeout(finish, 1000).unref();
  });
}

export function tryKill(child: ChildProcess, signal: NodeJS.Signals): boolean {
  try {
    child.kill(signal);
    return true;
  } catch {
    return false;
  }
}

export function tryEnd(stream: { end: () => void } | null | undefined): void {
  if (!stream) return;
  try {
    stream.end();
  } catch {
    // ignore
  }
}

export async function terminateChild(
  child: ChildProcess,
  termAfterMs = 2000,
  killAfterMs = 1000,
): Promise<void> {
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    child.once("close", finish);
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        tryKill(child, "SIGTERM");
        setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) {
            tryKill(child, "SIGKILL");
          }
          finish();
        }, killAfterMs).unref();
      } else finish();
    }, termAfterMs).unref();
    if (child.exitCode !== null || child.signalCode !== null) finish();
  });
}
