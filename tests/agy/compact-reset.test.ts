import { describe, expect, it } from "vitest";
import {
  consumeCompactSeed,
  resetPoolForCompaction,
  resetSessionState,
  setCompactSeed,
} from "../../extensions/antigravity.ts";
import { compositeKey } from "../../src/agy/agy-pool.ts";

describe("resetSessionState", () => {
  it("disposes pool entry and clears session store", async () => {
    const disposed: string[] = [];
    const sets: Array<[string, string | null, string | undefined]> = [];
    const key = compositeKey("sess-reset", "/tmp/cwd");
    await resetSessionState(
      {
        disposeKey: (k: string) => {
          disposed.push(k);
          return Promise.resolve(true);
        },
        set: (k: string, c: string | null, p?: string) => {
          sets.push([k, c, p]);
          return Promise.resolve(undefined);
        },
      },
      key,
    );
    expect(disposed).toEqual([key]);
    expect(sets).toEqual([[key, null, ""]]);
  });

  it("tolerates backend errors gracefully", async () => {
    const key = compositeKey("sess-fail", "/tmp/cwd");
    await expect(
      resetSessionState(
        {
          disposeKey: () => Promise.reject(new Error("dispose fail")),
          set: () => Promise.reject(new Error("set fail")),
        },
        key,
      ),
    ).resolves.toBeUndefined();
  });
});

describe("compact seed helpers", () => {
  it("setCompactSeed ignores empty summaries, consume is one-shot", () => {
    const key = compositeKey("seed-helpers", "/tmp/cwd");
    setCompactSeed(key, "   ");
    expect(consumeCompactSeed(key)).toBeUndefined();
    setCompactSeed(key, "  Did X.  ");
    expect(consumeCompactSeed(key)).toBe("Did X.");
    expect(consumeCompactSeed(key)).toBeUndefined();
  });
});

describe("resetPoolForCompaction", () => {
  it("disposes, clears binding, and seeds summary", async () => {
    const disposed: string[] = [];
    const sets: Array<[string, string | null, string | undefined]> = [];
    const key = compositeKey("sess1", "/tmp/cwd");
    await resetPoolForCompaction(
      {
        disposeKey: (k: string) => {
          disposed.push(k);
          return Promise.resolve(true);
        },
        set: (k: string, c: string | null, p?: string) => {
          sets.push([k, c, p]);
          return Promise.resolve(undefined);
        },
      },
      key,
      "  Did X.  ",
    );
    expect(disposed).toEqual([key]);
    expect(sets).toEqual([[key, null, ""]]);
    expect(consumeCompactSeed(key)).toBe("Did X.");
    expect(consumeCompactSeed(key)).toBeUndefined();
  });

  it("tolerates backend failures and empty summary", async () => {
    const key = compositeKey("sess2", "/tmp/cwd");
    await resetPoolForCompaction(
      {
        disposeKey: () => Promise.reject(new Error("boom")),
        set: () => Promise.reject(new Error("boom")),
      },
      key,
      "   ",
    );
    expect(consumeCompactSeed(key)).toBeUndefined();
  });
});
