import { describe, it, expect } from "vitest";
import { tryKill } from "../../src/shared/process.ts";
import type { ChildProcess } from "node:child_process";

describe("tryKill", () => {
  it("covers true and false", () => {
    const ok = { kill: () => true } as unknown as ChildProcess;
    expect(tryKill(ok, "SIGKILL")).toBe(true);
    const fail = { kill: () => { throw new Error("e"); } } as unknown as ChildProcess;
    expect(tryKill(fail, "SIGKILL")).toBe(false);
  });
});
