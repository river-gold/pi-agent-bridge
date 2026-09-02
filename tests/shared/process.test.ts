import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { disposeChild } from "../../src/shared/process.ts";

describe("process disposeChild", () => {
  it("null returns", async () => {
    await disposeChild(null);
  });

  it("already exited child returns quickly", async () => {
    const child = spawn(process.execPath, ["-e", "process.exit(0)"]);
    await new Promise((r) => child.on("close", r));
    await disposeChild(child);
  });

  it("kills running child", async () => {
    const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"]);
    // ensure spawned
    await new Promise((r) => setTimeout(r, 50));
    await disposeChild(child);
    expect(child.signalCode === "SIGKILL" || child.exitCode !== null || child.killed).toBeTruthy();
  });

  it("handles missing stdio", async () => {
    const child = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
    await new Promise((r) => child.on("close", r));
    await disposeChild(child);
  });
});
