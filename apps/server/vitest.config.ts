import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "./persistenceService.js": fileURLToPath(
        new URL("./test/mocks/persistenceService.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      reporter: ["text", "html", "lcov", "json"],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 60,
        statements: 70,
      },
      exclude: ["dist/**", "coverage/**", "test/**", "vitest.config.ts"],
    },
  },
});
