import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
  it("pi --list-models shows agy models from mock binary", async (t) => {
    const piPath = await whichPi();
    if (!piPath) {
      t.skip("pi CLI not installed");
      return;
    }

    const root = await mkdtemp(join(tmpdir(), "pi-agy-cli-e2e-"));
    const home = join(root, "home");
    const agentDir = join(home, ".pi", "agent");
    const cacheDir = join(home, ".cache", "pi-agent-bridge");
    await mkdir(agentDir, { recursive: true });
    await mkdir(cacheDir, { recursive: true });

    const mock = join(root, "mock-agy.mjs");
    await writeFile(
      mock,
      `#!${process.execPath}
const args = process.argv.slice(2);
if (args[0] === "models") {
  console.log("Fetching available models...");
  console.log("e2e-flash-high\\tE2E Flash (High)");
  console.log("e2e-flash-low\\tE2E Flash (Low)");
  console.log("e2e-solo\\tE2E Solo");
  process.exit(0);
}
console.error("unexpected args", args);
process.exit(1);
`,
      "utf-8",
    );
    await chmod(mock, 0o755);

    try {
      const result = await run(
        piPath,
        ["-e", repoRoot, "--list-models"],
        {
          ...process.env,
          HOME: home,
          AGY_BINARY: mock,
          // isolate pi agent dir
          PI_CODING_AGENT_DIR: agentDir,
        },
        45_000,
      );

      const out = result.stdout + "\n" + result.stderr;
      assert.equal(result.code, 0, out);
      assert.match(out, /\bagy\b/);
      assert.match(out, /e2e-flash/);
      assert.match(out, /e2e-solo/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
