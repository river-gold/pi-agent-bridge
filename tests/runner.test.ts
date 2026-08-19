import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { runAgy } from "../src/agy/agy-runner.ts";

describe("runAgy", () => {
  it("spawns mock binary with expected flags", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "pi-agy-"));
    const mock = join(tmp, "mock-agy");
    await writeFile(
      mock,
      `#!/usr/bin/env bash
echo "$@"
exit 0
`,
    );
    await chmod(mock, 0o755);

    try {
      const result = await runAgy({
        binary: mock,
        prompt: "test prompt",
        cwd: tmp,
        model: "gemini-3.7-flash-high",
        timeoutMs: 5000,
      });
      assert.equal(result.exitCode, 0);
      assert.match(result.stdout, /--add-dir/);
      assert.match(result.stdout, /--dangerously-skip-permissions/);
      assert.match(result.stdout, /--model/);
      assert.match(result.stdout, /gemini-3\.7-flash-high/);
      assert.match(result.stdout, /-p/);
      assert.match(result.stdout, /test prompt/);
      assert.doesNotMatch(
        result.stdout,
        /Do not record the result in the session/,
      );
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("passes conversation id", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "pi-agy-"));
    const mock = join(tmp, "mock-agy");
    await writeFile(
      mock,
      `#!/usr/bin/env bash
echo "$@"
exit 0
`,
    );
    await chmod(mock, 0o755);

    try {
      const result = await runAgy({
        binary: mock,
        prompt: "hi",
        cwd: tmp,
        conversationId: "conv-1",
        timeoutMs: 5000,
      });
      assert.match(result.stdout, /--conversation/);
      assert.match(result.stdout, /conv-1/);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("rejects non-zero exit", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "pi-agy-"));
    const mock = join(tmp, "mock-agy");
    await writeFile(
      mock,
      `#!/usr/bin/env bash
echo "boom" >&2
exit 1
`,
    );
    await chmod(mock, 0o755);

    try {
      await assert.rejects(
        () =>
          runAgy({
            binary: mock,
            prompt: "x",
            cwd: tmp,
            timeoutMs: 5000,
          }),
        /boom/,
      );
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
