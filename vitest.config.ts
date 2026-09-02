import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules", "tests/e2e/**"],
  },
  coverage: {
    provider: "v8",
    include: ["src/**/*.ts"],
    exclude: ["tests/**", "node_modules/**"],
    reporter: ["text", "json"],
    thresholds: {
      statements: 100,
      branches: 100,
      functions: 100,
      lines: 100,
    },
  },
});
