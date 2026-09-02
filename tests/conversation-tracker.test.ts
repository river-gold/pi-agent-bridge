import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findNewConversation, snapshot } from "../src/agy/conversation-tracker.ts";

describe("conversation-tracker", () => {
  it("snapshot filters .pb", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ct-"));
    try {
      await writeFile(join(dir, "a.pb"), "");
      await writeFile(join(dir, "b.pb"), "");
      await writeFile(join(dir, "c.txt"), "");
      await mkdir(join(dir, "sub"));
      const s = await snapshot(dir);
      expect(s.has("a")).toBe(true);
      expect(s.has("b")).toBe(true);
      expect(s.has("c")).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("snapshot missing dir returns empty", async () => {
    const s = await snapshot(join(tmpdir(), `nope-${Date.now()}`));
    expect(s.size).toBe(0);
  });

  it("findNewConversation single new", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ct2-"));
    try {
      await writeFile(join(dir, "x.pb"), "");
      const before = await snapshot(dir);
      await writeFile(join(dir, "y.pb"), "");
      expect(await findNewConversation(before, dir)).toBe("y");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("findNewConversation none or multiple returns null", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ct3-"));
    try {
      await writeFile(join(dir, "a.pb"), "");
      const before = await snapshot(dir);
      expect(await findNewConversation(before, dir)).toBe(null);
      await writeFile(join(dir, "b.pb"), "");
      await writeFile(join(dir, "c.pb"), "");
      expect(await findNewConversation(before, dir)).toBe(null);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
