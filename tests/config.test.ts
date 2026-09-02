import { describe, expect, it, afterEach } from "vitest";
import { loadConfig } from "../src/agy/config.ts";

function cleanEnv() {
  delete process.env.AGY_BINARY;
  delete process.env.AGY_TIMEOUT_MS;
  delete process.env.AGY_EXTRA_ARGS;
  delete process.env.AGY_CONVERSATIONS_DIR;
}

describe("config", () => {
  afterEach(cleanEnv);

  it("default values", () => {
    cleanEnv();
    const c = loadConfig();
    expect(c.binary).toBe("agy");
    expect(c.timeoutMs).toBe(300000);
    expect(c.extraArgs).toEqual([]);
    expect(c.conversationsDir).toContain("conversations");
  });

  it("envInt invalid falls back", () => {
    process.env.AGY_TIMEOUT_MS = "not-a-number";
    expect(loadConfig().timeoutMs).toBe(300000);
    process.env.AGY_TIMEOUT_MS = "0";
    expect(loadConfig().timeoutMs).toBe(300000);
    process.env.AGY_TIMEOUT_MS = "-5";
    expect(loadConfig().timeoutMs).toBe(300000);
    process.env.AGY_TIMEOUT_MS = "1000";
    expect(loadConfig().timeoutMs).toBe(1000);
    process.env.AGY_TIMEOUT_MS = "  2500  ";
    expect(loadConfig().timeoutMs).toBe(2500);
  });

  it("envList splits", () => {
    process.env.AGY_EXTRA_ARGS = "a  b\tc";
    expect(loadConfig().extraArgs).toEqual(["a", "b", "c"]);
    process.env.AGY_EXTRA_ARGS = "   ";
    expect(loadConfig().extraArgs).toEqual([]);
    delete process.env.AGY_EXTRA_ARGS;
    expect(loadConfig().extraArgs).toEqual([]);
  });

  it("env overrides binary and conversationsDir", () => {
    process.env.AGY_BINARY = "my-agy";
    process.env.AGY_CONVERSATIONS_DIR = "/tmp/convos";
    const c = loadConfig();
    expect(c.binary).toBe("my-agy");
    expect(c.conversationsDir).toBe("/tmp/convos");
    process.env.AGY_BINARY = "  ";
    expect(loadConfig().binary).toBe("agy");
  });

  it("overrides param wins", () => {
    cleanEnv();
    const c = loadConfig({ binary: "override-agy", timeoutMs: 123 });
    expect(c.binary).toBe("override-agy");
    expect(c.timeoutMs).toBe(123);
  });
});
