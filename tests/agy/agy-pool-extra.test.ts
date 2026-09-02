import { chmod, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  AgyPool,
  compositeKey,
  hashCwd,
  isCompositeKey,
  createAbortError,
  parseAgyLine,
  handleAgentResponse,
  pickString,
  createLatch,
  poolCloseMessage,
  poolExecBlockReason,
  writePoolPrompt,
  type AgentResponsePending,
} from "../../src/agy/agy-pool.ts";

function mockTemplate(handler: string): string {
  return `import { createInterface } from "node:readline";
const conv="conv-"+Math.random();
console.log(JSON.stringify({event:"init",conversation_id:conv}));
const rl=createInterface({input:process.stdin});
rl.on("line", async (line)=>{
  let msg; try{msg=JSON.parse(line);}catch{return;}
  if(msg.event!=="user") return;
  const prompt=msg.message?.content||"";
  ${handler}
});`;
}

async function makeMock(dir: string, handler: string) {
  const js = join(dir, `mock-${Date.now()}-${Math.random()}.mjs`);
  const wrap = join(dir, `wrap-${Date.now()}-${Math.random()}`);
  await writeFile(js, mockTemplate(handler));
  await writeFile(wrap, `#!/usr/bin/env bash\nexec ${process.execPath} ${JSON.stringify(js)} "$@"\n`);
  await chmod(js, 0o755);
  await chmod(wrap, 0o755);
  return wrap;
}

describe("agy-pool extra and edge cases", () => {
  it("hashCwd, compositeKey, isCompositeKey", () => {
    expect(hashCwd("x").length).toBe(16);
    expect(compositeKey("  ", "/tmp")).toContain("default::");
    expect(compositeKey("sid", "/tmp")).toContain("sid::");
    expect(compositeKey(undefined, "/tmp")).toContain("default::");
    expect(isCompositeKey("sess::0123456789abcdef")).toBe(true);
    expect(isCompositeKey("sess::short")).toBe(false);
    expect(isCompositeKey("sess-no-hex")).toBe(false);
  });

  it("createAbortError handling", () => {
    const existingAbort = new Error("already aborted");
    existingAbort.name = "AbortError";
    expect(createAbortError(existingAbort)).toBe(existingAbort);

    const normalErr = new Error("normal error");
    const converted = createAbortError(normalErr);
    expect(converted.name).toBe("AbortError");
    expect(converted.message).toBe("normal error");

    const strAbort = createAbortError("custom string abort");
    expect(strAbort.name).toBe("AbortError");
    expect(strAbort.message).toBe("custom string abort");

    const undefAbort = createAbortError(undefined);
    expect(undefAbort.name).toBe("AbortError");
    expect(undefAbort.message).toBe("The operation was aborted");

    const objAbort = createAbortError({ some: "obj" });
    expect(objAbort.name).toBe("AbortError");
    expect(objAbort.message).toBe("The operation was aborted");
  });

  it("pickString, latch, close message, exec block reason", () => {
    expect(pickString("a", "b")).toBe("a");
    expect(pickString(1, "b")).toBe("b");
    expect(pickString(1, 2)).toBeUndefined();

    const latch = createLatch();
    expect(latch.tryEnter()).toBe(true);
    expect(latch.tryEnter()).toBe(false);

    expect(poolCloseMessage(null, "SIGKILL")).toBe("agy pool process killed by SIGKILL");
    expect(poolCloseMessage(null, null)).toBe("agy pool process exited unknown");
    expect(poolCloseMessage(1, null)).toBe("agy pool process exited 1");

    expect(poolExecBlockReason({ closed: true, exitCode: null, signalCode: null, stdinWritable: true })).toBe(
      "agy pool entry closed",
    );
    expect(poolExecBlockReason({ closed: false, exitCode: 1, signalCode: null, stdinWritable: true })).toBe(
      "agy pool process exited",
    );
    expect(poolExecBlockReason({ closed: false, exitCode: null, signalCode: "SIGTERM", stdinWritable: true })).toBe(
      "agy pool process exited",
    );
    expect(poolExecBlockReason({ closed: false, exitCode: null, signalCode: null, stdinWritable: false })).toBe(
      "agy pool stdin not writable",
    );
    expect(poolExecBlockReason({ closed: false, exitCode: null, signalCode: null })).toBe(
      "agy pool stdin not writable",
    );
    expect(poolExecBlockReason({ closed: false, exitCode: null, signalCode: null, stdinWritable: true })).toBeNull();
  });

  it("writePoolPrompt success, backpressure, callback error, throw", () => {
    const writes: string[] = [];
    let drain: (() => void) | undefined;
    const stdin = {
      write: (chunk: string, cb?: (err?: Error | null) => void) => {
        writes.push(chunk);
        cb?.(null);
        return true;
      },
    };
    writePoolPrompt(stdin, "hi", () => {
      throw new Error("should not error");
    });
    expect(writes[0]).toContain('"event":"user"');

    const errors: Error[] = [];
    writePoolPrompt(
      {
        write: (_chunk, cb) => {
          cb?.(new Error("pipe broken"));
          return true;
        },
      },
      "x",
      (e) => errors.push(e),
    );
    expect(errors[0]?.message).toBe("failed to write to agy pool: pipe broken");

    writePoolPrompt(
      {
        write: () => {
          throw new Error("sync throw in write");
        },
      },
      "x",
      (e) => errors.push(e),
    );
    expect(errors[1]?.message).toContain("sync throw in write");

    writePoolPrompt(
      {
        write: (_chunk, cb) => {
          cb?.(null);
          return false;
        },
        once: (ev, fn) => {
          if (ev === "drain") drain = fn;
        },
      },
      "x",
      () => {
        throw new Error("should not error");
      },
    );
    expect(drain).toBeTypeOf("function");
    drain?.();
  });

  it("parseAgyLine edge cases", () => {
    expect(parseAgyLine("   ")).toBeNull();
    expect(parseAgyLine("not json string")).toBeNull();
    expect(parseAgyLine("{bad json")).toBeNull();
    expect(parseAgyLine(JSON.stringify({ other: "field" }))).toBeNull();
    expect(parseAgyLine(JSON.stringify({ event: 123 }))).toBeNull();
    expect(parseAgyLine(JSON.stringify({ event: "init", conversation_id: "c1" }))).toEqual({
      event: "init",
      conversation_id: "c1",
    });
  });

  it("handleAgentResponse branch matrix", () => {
    const pending: AgentResponsePending = {
      accumulatedText: "hello ",
      onEvent: vi.fn(),
      streamError: undefined,
    };

    handleAgentResponse(null, "agent_response", "test", "ACTIVE", undefined);
    handleAgentResponse(pending, "tool", "test", "ACTIVE", undefined);
    handleAgentResponse(pending, "agent_response", 123, "ACTIVE", undefined);
    expect(pending.onEvent).not.toHaveBeenCalled();

    handleAgentResponse(pending, "agent_response", "world", "ACTIVE", undefined);
    expect(pending.accumulatedText).toBe("hello world");
    expect(pending.onEvent).toHaveBeenCalledWith({ type: "text", text: "world" });

    handleAgentResponse(pending, "agent_response", "!", "DONE", undefined);
    expect(pending.accumulatedText).toBe("hello world!");
    expect(pending.onEvent).toHaveBeenCalledWith({ type: "text", text: "!" });

    handleAgentResponse(pending, "agent_response", "hello world! extra", undefined, "DONE");
    expect(pending.accumulatedText).toBe("hello world! extra");
    expect(pending.onEvent).toHaveBeenCalledWith({ type: "text", text: " extra" });

    const callCount = (pending.onEvent as ReturnType<typeof vi.fn>).mock.calls.length;
    handleAgentResponse(pending, "agent_response", "hello world! extra", undefined, "DONE");
    expect((pending.onEvent as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callCount);

    handleAgentResponse(pending, "agent_response", "completely different", undefined, "DONE");
    expect(pending.streamError).toBeInstanceOf(Error);

    const pending2: AgentResponsePending = { accumulatedText: "", onEvent: vi.fn() };
    handleAgentResponse(pending2, "agent_response", "delta", undefined, undefined);
    expect(pending2.accumulatedText).toBe("delta");
    handleAgentResponse(pending2, "agent_response", "", undefined, undefined);
    expect(pending2.accumulatedText).toBe("delta");

    const pending3: AgentResponsePending = { accumulatedText: "x", streamError: undefined };
    handleAgentResponse(pending3, "agent_response", "y", "ACTIVE", undefined);
    expect(pending3.accumulatedText).toBe("xy");
    handleAgentResponse(pending3, "agent_response", "xy z", undefined, "DONE");
    expect(pending3.accumulatedText).toBe("xy z");
    handleAgentResponse(pending3, "agent_response", "nope", undefined, "DONE");
    expect(pending3.streamError).toBeInstanceOf(Error);
    const firstErr = pending3.streamError;
    handleAgentResponse(pending3, "agent_response", "still-nope", undefined, "DONE");
    expect(pending3.streamError).toBe(firstErr);
  });

  it("acquireForSession, acquireByKey, and handle getters", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pool-getters-"));
    const wrap = await makeMock(
      dir,
      `console.log(JSON.stringify({event:"result",result:{status:"SUCCESS",response:"ok",conversation_id:conv}}));`,
    );
    const pool = new AgyPool({ binary: wrap, timeoutMs: 2000 });
    try {
      const h1 = pool.acquireForSession("sess1", "/tmp");
      expect(h1.key).toContain("sess1::");
      expect(h1.cwd).toBe("/tmp");
      expect(h1.conversationId).toBeUndefined();

      const r1 = await h1.prompt("hi");
      expect(r1.stdout).toBe("ok");
      expect(h1.conversationId).toBeTruthy();

      const k = compositeKey("sess2", "/tmp");
      const h2 = pool.acquireByKey(k, "/tmp");
      expect(h2.key).toBe(k);
      const r2 = await h2.prompt("hi2");
      expect(r2.stdout).toBe("ok");

      const hDefault = pool.acquire("   ", "/tmp");
      expect(hDefault.key).toContain("default::");
      const hUndef = pool.acquire(undefined, "/tmp");
      expect(hUndef.key).toContain("default::");
    } finally {
      await pool.disposeAll();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("conversationId tracking across acquire calls", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pool-conv-"));
    const wrap = await makeMock(
      dir,
      `console.log(JSON.stringify({event:"result",result:{status:"SUCCESS",response:"ok",conversation_id:conv}}));`,
    );
    const pool = new AgyPool({ binary: wrap, timeoutMs: 2000 });
    try {
      pool.acquire("conv-test", "/tmp");
      const h2 = pool.acquire("conv-test", "/tmp", undefined, undefined, "custom-conv-id");
      expect(h2.conversationId).toBe("custom-conv-id");

      const h3 = pool.acquire("conv-test", "/tmp", undefined, undefined, "ignored-conv-id");
      expect(h3.conversationId).toBe("custom-conv-id");

      await h3.dispose();
      const h4 = pool.acquire("conv-test", "/tmp");
      expect(h4.conversationId).toBeUndefined();
      const r4 = await h4.prompt("hi");
      expect(r4.stdout).toBe("ok");
    } finally {
      await pool.disposeAll();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("step_update and result event edge cases", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pool-events-"));
    const wrap = await makeMock(
      dir,
      `
      console.log(JSON.stringify({event:"other", conversation_id:"conv-top"}));
      console.log(JSON.stringify({event:"init", conversation_id:"conv-init"}));
      console.log(JSON.stringify({event:"step_update", conversation_id:"conv-step", step_type:"agent_response", text_delta:"step-text", state:"ACTIVE"}));
      console.log(JSON.stringify({event:"step_update", step_update:{step_type:"tool", tool_name:"grep", tool_info:{parameters:{q:"test"}, output:"found"}, state:"DONE"}}));
      console.log(JSON.stringify({event:"result", conversation_id:"conv-result", result:{status:"SUCCESS", response:"final answer", usage:{input_tokens:10, output_tokens:20, total_tokens:30}}}));
    `,
    );
    const pool = new AgyPool({ binary: wrap, timeoutMs: 2000 });
    try {
      const events: { type: string }[] = [];
      const res = await pool.acquire("events-key", "/tmp").prompt("test", {
        onEvent: (e) => events.push(e),
      });
      expect(res.stdout).toBe("step-text");
      expect(res.conversationId).toBe("conv-result");
      expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 20, totalTokens: 30 });
      expect(events.some((e) => e.type === "tool_end")).toBe(true);
    } finally {
      await pool.disposeAll();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("settlePending error status and stderr branches", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pool-errs-"));

    const wrapFail1 = await makeMock(
      dir,
      `console.log(JSON.stringify({event:"result", result:{status:"FAILED", error:"backend exploded"}}));`,
    );
    const pool1 = new AgyPool({ binary: wrapFail1, timeoutMs: 2000 });
    await expect(pool1.acquire("f1", "/tmp").prompt("hi")).rejects.toThrow("backend exploded");
    await pool1.disposeAll();

    const wrapFail2 = await makeMock(
      dir,
      `console.log(JSON.stringify({event:"result", result:{status:"FAILED"}}));`,
    );
    const pool2 = new AgyPool({ binary: wrapFail2, timeoutMs: 2000 });
    await expect(pool2.acquire("f2", "/tmp").prompt("hi")).rejects.toThrow("agy failed with status FAILED");
    await pool2.disposeAll();

    const wrapFail3 = await makeMock(
      dir,
      `console.error("stderr failure log"); console.log(JSON.stringify({event:"result", result:{}}));`,
    );
    const pool3 = new AgyPool({ binary: wrapFail3, timeoutMs: 5000 });
    await expect(pool3.acquire("f3", "/tmp").prompt("hi")).rejects.toThrow("stderr failure log");
    await pool3.disposeAll();

    const wrapFail4 = await makeMock(
      dir,
      `
      console.log(JSON.stringify({event:"step_update", step_update:{step_type:"agent_response", text_delta:"one", state:"ACTIVE"}}));
      console.log(JSON.stringify({event:"step_update", step_update:{step_type:"agent_response", text_delta:"mismatch", status:"DONE"}}));
      console.log(JSON.stringify({event:"result", result:{status:"SUCCESS"}}));
      `,
    );
    const pool4 = new AgyPool({ binary: wrapFail4, timeoutMs: 2000 });
    await expect(pool4.acquire("f4", "/tmp").prompt("hi")).rejects.toThrow("Inconsistent stream");
    await pool4.disposeAll();

    await rm(dir, { recursive: true, force: true });
  });

  it("dispose then prompt is closed; hanging prompt rejects on dispose", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pool-closed-"));
    const wrap = await makeMock(dir, ``);
    const pool = new AgyPool({ binary: wrap, timeoutMs: 5000, idleTimeoutMs: 0 });
    try {
      const handle = pool.acquire("s-closed", "/tmp");
      expect(pool.size()).toBe(1);
      const hanging = handle.prompt("wait");
      await new Promise((r) => setTimeout(r, 80));
      await handle.dispose();
      await expect(hanging).rejects.toThrow(/agy pool entry disposed|agy pool entry closed/);
      await expect(handle.prompt("hi")).rejects.toThrow("agy pool entry closed");
    } finally {
      await pool.disposeAll();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("child process close while a turn is pending", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pool-close-"));
    const wrap = await makeMock(dir, `process.kill(process.pid, "SIGKILL");`);
    const pool = new AgyPool({ binary: wrap, timeoutMs: 5000, idleTimeoutMs: 0 });
    try {
      await expect(pool.acquire("s-close", "/tmp").prompt("test-sig")).rejects.toThrow(
        /agy pool process killed by SIGKILL|agy pool entry closed|agy pool process exited/,
      );
    } finally {
      await pool.disposeAll();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("spawn error closes the entry", async () => {
    const pool = new AgyPool({
      binary: "/no-such-agy-binary-xyz",
      timeoutMs: 2000,
      idleTimeoutMs: 0,
    });
    const handle = pool.acquire("missing", "/tmp");
    await new Promise((r) => setTimeout(r, 50));
    await expect(handle.prompt("x")).rejects.toThrow();
    await pool.disposeAll();
  });

  it("abort with custom reason", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pool-abort-"));
    const wrap = await makeMock(dir, ``);
    const pool = new AgyPool({ binary: wrap, timeoutMs: 5000 });
    try {
      const handle = pool.acquire("abort-reason", "/tmp");
      const ac = new AbortController();
      ac.abort(new Error("custom abort"));
      await expect(handle.prompt("x", { signal: ac.signal })).rejects.toMatchObject({
        name: "AbortError",
        message: "custom abort",
      });
    } finally {
      await pool.disposeAll();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("spawn args, mismatch respawn, nested result conversation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pool-spawn-args-"));
    const argFile = join(dir, "args.json");
    const js = join(dir, "mock-args.mjs");
    const wrap = join(dir, "wrap-args");
    await writeFile(
      js,
      `import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
writeFileSync(${JSON.stringify(argFile)}, JSON.stringify(process.argv.slice(2)));
const rl=createInterface({input:process.stdin});
rl.on("line", (line)=>{
  let msg; try{msg=JSON.parse(line);}catch{return;}
  if(msg.event!=="user") return;
  console.log(JSON.stringify({event:"result",result:{status:"SUCCESS",response:"ok",conversation_id:"from-result"}}));
});
`,
    );
    await writeFile(wrap, `#!/usr/bin/env bash\nexec ${process.execPath} ${JSON.stringify(js)} "$@"\n`);
    await chmod(js, 0o755);
    await chmod(wrap, 0o755);

    const pool = new AgyPool({
      binary: wrap,
      extraArgs: ["--foo"],
      timeoutMs: 2000,
      idleTimeoutMs: 0,
    });
    try {
      const h1 = pool.acquire("args-sess", "/tmp", "model-x", "high", "conv-1");
      const r1 = await h1.prompt("hi");
      expect(r1).toMatchObject({ stdout: "ok", conversationId: "from-result" });
      const args = JSON.parse(await readFile(argFile, "utf-8"));
      expect(args).toContain("--foo");
      expect(args).toContain("--model");
      expect(args).toContain("model-x");
      expect(args).toContain("--effort");
      expect(args).toContain("high");
      expect(args).toContain("--conversation");
      expect(args).toContain("conv-1");

      const r2 = await pool.acquire("args-sess", "/tmp", "model-y", "high", "conv-1").prompt("hi");
      expect(r2.stdout).toBe("ok");
      const r3 = await pool.acquire("args-sess", "/tmp", "model-y", "low", "conv-1").prompt("hi");
      expect(r3.stdout).toBe("ok");

      await pool.acquire("blank-effort", "/tmp", "model-x", "   ").prompt("hi");
      const blankArgs = JSON.parse(await readFile(argFile, "utf-8"));
      expect(blankArgs.includes("--effort")).toBe(false);

      const key = compositeKey("comp", "/tmp");
      const hc = pool.acquire(key, "/tmp");
      expect(hc.key).toBe(key);
    } finally {
      await pool.disposeAll();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("empty constructor uses defaults", async () => {
    const pool = new AgyPool();
    expect(pool.size()).toBe(0);
    await pool.disposeAll();
  });

  it("constructor defaults and closed entry respawn during dispose", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pool-defaults-"));
    const wrap = await makeMock(
      dir,
      `console.log(JSON.stringify({event:"result",result:{status:"SUCCESS",response:"ok"}}));`,
    );
    const pool = new AgyPool({ binary: wrap });
    try {
      const h1 = pool.acquire("k", "/tmp");
      const disposing = h1.dispose();
      const h2 = pool.acquire("k", "/tmp");
      await disposing;
      expect(await h2.prompt("hi")).toMatchObject({ stdout: "ok" });
    } finally {
      await pool.disposeAll();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("nested result conversation and in-flight abort", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pool-nested-"));
    const wrapNested = await makeMock(
      dir,
      `console.log(JSON.stringify({event:"result",result:{status:"SUCCESS",response:"n",conversation_id:"nested"}}));`,
    );
    const poolNested = new AgyPool({ binary: wrapNested, timeoutMs: 2000 });
    try {
      expect(await poolNested.acquire("nested", "/tmp").prompt("x")).toMatchObject({
        stdout: "n",
        conversationId: "nested",
      });
    } finally {
      await poolNested.disposeAll();
    }

    const wrapHang = await makeMock(dir, `await new Promise(()=>{});`);
    const poolHang = new AgyPool({ binary: wrapHang, timeoutMs: 5000 });
    try {
      const ac = new AbortController();
      const hanging = poolHang.acquire("abort-me", "/tmp").prompt("abort-me", { signal: ac.signal });
      await new Promise((r) => setTimeout(r, 80));
      ac.abort();
      await expect(hanging).rejects.toMatchObject({ name: "AbortError" });
    } finally {
      await poolHang.disposeAll();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("handleLine fallbacks, empty success, flat result, tools", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pool-lines-"));
    const wrap = await makeMock(
      dir,
      `
      console.log("partial-no-newline");
      console.log(JSON.stringify({event:"ping"}));
      console.log(JSON.stringify({event:"step_update", conversation_id:"parsed-conv", step_update:{ignored:true}, step_type:"agent_response", text_delta:"hel", state:"ACTIVE", status:"x"}));
      console.log(JSON.stringify({event:"step_update", step_update:{step_type:"tool", tool_name:"read", state:"ACTIVE"}}));
      console.log(JSON.stringify({event:"step_update", step_update:{step_type:"tool", tool_name:"read", state:"OTHER", step_index:3, tool_info:{output:123}}}));
      console.log(JSON.stringify({event:"result", result:{status:"SUCCESS", response:"ok", usage:{input_tokens:1}}}));
    `,
    );
    const pool = new AgyPool({ binary: wrap, timeoutMs: 5000, idleTimeoutMs: 0 });
    try {
      const events: { type: string }[] = [];
      const acOk = new AbortController();
      const res = await pool.acquire("lines", "/tmp").prompt("hi", {
        signal: acOk.signal,
        onEvent: (e) => events.push(e),
      });
      expect(res.stdout).toBe("hel");
      expect(events.some((e) => e.type === "tool_start")).toBe(true);

      const wrapEmpty = await makeMock(
        dir,
        `console.log(JSON.stringify({event:"result", result:{status:"SUCCESS"}}));`,
      );
      const poolEmpty = new AgyPool({ binary: wrapEmpty, timeoutMs: 2000 });
      expect(await poolEmpty.acquire("empty-ok", "/tmp").prompt("x")).toMatchObject({ stdout: "" });
      await poolEmpty.disposeAll();

      const wrapFailWs = await makeMock(
        dir,
        `console.log(JSON.stringify({event:"result", result:{status:"FAILED", error:"   "}}));`,
      );
      const poolFail = new AgyPool({ binary: wrapFailWs, timeoutMs: 2000 });
      await expect(poolFail.acquire("fail-ws", "/tmp").prompt("x")).rejects.toThrow(
        "agy failed with status FAILED",
      );
      await poolFail.disposeAll();

      const wrapFlat = await makeMock(
        dir,
        `console.log(JSON.stringify({event:"result", status:"SUCCESS", response:"flat"}));`,
      );
      const poolFlat = new AgyPool({ binary: wrapFlat, timeoutMs: 2000 });
      expect(await poolFlat.acquire("flat-result", "/tmp").prompt("x")).toMatchObject({ stdout: "flat" });
      await poolFlat.disposeAll();

      const wrapNone = await makeMock(
        dir,
        `console.log(JSON.stringify({event:"result", result:{status:"SUCCESS", response:"plain"}}));`,
      );
      const poolNone = new AgyPool({ binary: wrapNone, timeoutMs: 2000 });
      const none = await poolNone.acquire("no-conv", "/tmp").prompt("x");
      expect(none.stdout).toBe("plain");
      await poolNone.disposeAll();
    } finally {
      await pool.disposeAll();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
