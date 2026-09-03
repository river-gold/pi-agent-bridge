type ExitStatus = { exitCode: number | null; signalCode: NodeJS.Signals | null };
type Killable = { kill(signal: NodeJS.Signals): boolean };
type Listenable = { once(event: string, listener: () => void): unknown };
type StreamContainer = {
  stdin?: { destroy(): void } | null | undefined;
  stdout?: { destroy(): void } | null | undefined;
  stderr?: { destroy(): void } | null | undefined;
};

function destroyStream(stream: { destroy: () => void } | undefined | null): void {
  if (!stream) return;
  try {
    stream.destroy();
  } catch {
    // ignore
  }
}

export function isAlreadyExited(child: ExitStatus): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

/** Close stdio and SIGKILL so the Node event loop can exit. */
export async function disposeChild(
  child: (ExitStatus & Killable & Listenable & StreamContainer) | null,
): Promise<void> {
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

export function tryKill(child: Killable, signal: NodeJS.Signals): boolean {
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
  child: ExitStatus & Killable & Listenable,
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
