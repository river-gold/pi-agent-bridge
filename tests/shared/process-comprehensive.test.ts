import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
  disposeChild,
  tryKill,
  isAlreadyExited,
  tryEnd,
  terminateChild,
} from "../../src/shared/process.ts";

describe("process comprehensive", () => {
  it("isAlreadyExited and tryKill", () => {
    expect(isAlreadyExited({ exitCode: 0, signalCode: null })).toBe(true);
    expect(isAlreadyExited({ exitCode: null, signalCode: "SIGTERM" })).toBe(true);
    expect(isAlreadyExited({ exitCode: null, signalCode: null })).toBe(false);
    expect(tryKill({ kill: () => true }, "SIGKILL")).toBe(true);
    expect(
      tryKill(
        {
          kill: () => {
            throw new Error("e");
          },
        },
        "SIGKILL",
      ),
    ).toBe(false);
  });
  it("disposeChild with tryKill false", async () => {
    const child = Object.assign(new EventEmitter(), {
      stdin: { destroy: () => {} },
      stdout: { destroy: () => {} },
      stderr: { destroy: () => {} },
      exitCode: null,
      signalCode: null,
      once: (_ev: string, cb: () => void) => {
        setTimeout(cb, 10);
      },
      kill: () => {
        throw new Error("kill fail");
      },
    });
    await disposeChild(child);
  });
  it("destroyStream swallows destroy errors", async () => {
    const child = Object.assign(new EventEmitter(), {
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
    });
    await disposeChild(child);
  });
  it("disposeChild already exited", async () => {
    const child = Object.assign(new EventEmitter(), {
      stdin: { destroy: () => {} },
      stdout: { destroy: () => {} },
      stderr: { destroy: () => {} },
      exitCode: 0,
      signalCode: null,
      once: () => {},
      kill: () => true,
    });
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
    const child = Object.assign(new EventEmitter(), {
      exitCode: 0,
      signalCode: null,
      kill: vi.fn(),
    });
    await terminateChild(child, 20, 20);
    expect(vi.mocked(child.kill).mock.calls.length).toBe(0);
  });
  it("terminateChild SIGTERM then SIGKILL", async () => {
    vi.useFakeTimers();
    try {
      const child = Object.assign(new EventEmitter(), {
        exitCode: null,
        signalCode: null,
        kill: vi.fn(),
      });
      const p = terminateChild(child, 2000, 1000);
      await vi.advanceTimersByTimeAsync(2000);
      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
      await vi.advanceTimersByTimeAsync(1000);
      expect(child.kill).toHaveBeenCalledWith("SIGKILL");
      child.emit("close");
      await p;
    } finally {
      vi.useRealTimers();
    }
  });
  it("terminateChild skips SIGKILL after SIGTERM exit", async () => {
    vi.useFakeTimers();
    try {
      const child = Object.assign(new EventEmitter(), {
        exitCode: null,
        signalCode: null,
        kill: vi.fn(),
      });
      const p = terminateChild(child, 2000, 1000);
      await vi.advanceTimersByTimeAsync(2000);
      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
      Object.assign(child, { exitCode: 0 });
      await vi.advanceTimersByTimeAsync(1000);
      expect(child.kill).not.toHaveBeenCalledWith("SIGKILL");
      await p;
    } finally {
      vi.useRealTimers();
    }
  });
});
