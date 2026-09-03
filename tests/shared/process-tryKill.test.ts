import { describe, it, expect } from "vitest";
import { tryKill } from "../../src/shared/process.ts";

describe("tryKill", () => {
  it("covers true and false", () => {
    const ok = { kill: () => true };
    expect(tryKill(ok, "SIGKILL")).toBe(true);
    const fail = {
      kill: () => {
        throw new Error("e");
      },
    };
    expect(tryKill(fail, "SIGKILL")).toBe(false);
  });
});
