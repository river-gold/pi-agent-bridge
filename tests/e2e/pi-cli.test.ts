import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function run(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs = 30_000,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      env,
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => {
      stdout += c.toString();
    });
    child.stderr.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ code, stdout, stderr });
    });
  });
}

async function whichPi(): Promise<string | null> {
  const result = await run("bash", ["-lc", "command -v pi"], process.env);
  const path = result.stdout.trim();
  return result.code === 0 && path ? path : null;
}

describe("e2e/pi-cli", () => {
  it("pi --list-models shows hardcoded agy/gemini-3.7-flash", async (t) => {
    const piPath = await whichPi();
    if (!piPath) {
      t.skip("pi CLI not installed");
      return;
    }

    const root = await mkdtemp(join(tmpdir(), "pi-agy-cli-e2e-"));
    const home = join(root, "home");
    const agentDir = join(home, ".pi", "agent");
    await mkdir(agentDir, { recursive: true });

    try {
      const result = await run(
        piPath,
        ["-e", repoRoot, "--list-models"],
        {
          ...process.env,
          HOME: home,
          PI_CODING_AGENT_DIR: agentDir,
        },
        45_000,
      );

      const out = result.stdout + "\n" + result.stderr;
      assert.equal(result.code, 0, out);
      assert.match(out, /\bagy\b/);
      assert.match(out, /gemini-3\.7-flash/);
      assert.doesNotMatch(out, /claude-sonnet-4-6/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
