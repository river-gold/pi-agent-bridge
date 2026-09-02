import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
  disposeChild,
  tryKill,
  isAlreadyExited,
  tryEnd,
  terminateChild,
} from "../../src/shared/process.ts";
import type { ChildProcess } from "node:child_process";

describe("process comprehensive", () => {
  it("isAlreadyExited and tryKill", () => {
    expect(isAlreadyExited({ exitCode: 0, signalCode: null } as unknown as ChildProcess)).toBe(
      true,
    );
    expect(
      isAlreadyExited({ exitCode: null, signalCode: "SIGTERM" } as unknown as ChildProcess),
    ).toBe(true);
    expect(isAlreadyExited({ exitCode: null, signalCode: null } as unknown as ChildProcess)).toBe(
      false,
    );
    expect(tryKill({ kill: () => true } as unknown as ChildProcess, "SIGKILL")).toBe(true);
    expect(
      tryKill(
        {
          kill: () => {
            throw new Error("e");
          },
        } as unknown as ChildProcess,
        "SIGKILL",
      ),
    ).toBe(false);
  });
  it("disposeChild with tryKill false", async () => {
    const child = {
      stdin: { destroy: () => {} },
      stdout: { destroy: () => {} },
      stderr: { destroy: () => {} },
      exitCode: null,
      signalCode: null,
      once: (ev: string, cb: () => void) => {
        setTimeout(cb, 10);
      },
      kill: () => {
        throw new Error("kill fail");
      },
    } as unknown as ChildProcess;
    await disposeChild(child);
  });
  it("destroyStream swallows destroy errors", async () => {
    const child = {
      stdin: {
        destroy: () => {
          throw new Error("stdin");
        },
      },
      stdout: {
        destroy: () => {
          throw new Error("stdout");
        },
      },
      stderr: {
        destroy: () => {
          throw new Error("stderr");
        },
      },
      exitCode: 0,
      signalCode: null,
      once: () => {},
      kill: () => true,
    } as unknown as ChildProcess;
    await disposeChild(child);
  });
  it("disposeChild already exited", async () => {
    const child = {
      stdin: { destroy: () => {} },
      stdout: { destroy: () => {} },
      stderr: { destroy: () => {} },
      exitCode: 0,
      signalCode: null,
      once: () => {},
      kill: () => true,
    } as unknown as ChildProcess;
    await disposeChild(child);
  });
  it("tryEnd covers null, success, and throw", () => {
    tryEnd(null);
    tryEnd(undefined);
    const end = vi.fn();
    tryEnd({ end });
    expect(end).toHaveBeenCalled();
    tryEnd({
      end: () => {
        throw new Error("end fail");
      },
    });
  });
  it("terminateChild already exited", async () => {
    const child = new EventEmitter() as unknown as ChildProcess;
    (child as { exitCode: number | null }).exitCode = 0;
    (child as { signalCode: NodeJS.Signals | null }).signalCode = null;
    (child as { kill: () => boolean }).kill = vi.fn();
    await terminateChild(child, 20, 20);
    expect((child as { kill: ReturnType<typeof vi.fn> }).kill).not.toHaveBeenCalled();
  });
  it("terminateChild SIGTERM then SIGKILL", async () => {
    vi.useFakeTimers();
    try {
      const child = new EventEmitter() as unknown as ChildProcess;
      (child as { exitCode: number | null }).exitCode = null;
      (child as { signalCode: NodeJS.Signals | null }).signalCode = null;
      const kill = vi.fn();
      (child as { kill: (s: NodeJS.Signals) => boolean }).kill = kill;
      const p = terminateChild(child, 2000, 1000);
      await vi.advanceTimersByTimeAsync(2000);
      expect(kill).toHaveBeenCalledWith("SIGTERM");
      await vi.advanceTimersByTimeAsync(1000);
      expect(kill).toHaveBeenCalledWith("SIGKILL");
      (child as EventEmitter).emit("close");
      await p;
    } finally {
      vi.useRealTimers();
    }
  });
  it("terminateChild skips SIGKILL after SIGTERM exit", async () => {
    vi.useFakeTimers();
    try {
      const child = new EventEmitter() as unknown as ChildProcess;
      (child as { exitCode: number | null }).exitCode = null;
      (child as { signalCode: NodeJS.Signals | null }).signalCode = null;
      const kill = vi.fn();
      (child as { kill: (s: NodeJS.Signals) => boolean }).kill = kill;
      const p = terminateChild(child, 2000, 1000);
      await vi.advanceTimersByTimeAsync(2000);
      expect(kill).toHaveBeenCalledWith("SIGTERM");
      (child as { exitCode: number | null }).exitCode = 0;
      await vi.advanceTimersByTimeAsync(1000);
      expect(kill).not.toHaveBeenCalledWith("SIGKILL");
      await p;
    } finally {
      vi.useRealTimers();
    }
  });
});
