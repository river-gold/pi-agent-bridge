import { describe, expect, it } from "vitest";
import { readModelsConfigFile } from "../../src/shared/models-config.ts";
describe("eacces", () => {
  it("throws", async () => {
    await expect(
      readModelsConfigFile("/tmp/x", async () => {
        throw Object.assign(new Error("e"), { code: "EACCES" });
      }),
    ).rejects.toThrow();
  });
});
