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
      reporter: ["text", "html", "lcov", "json"],
      exclude: ["dist/**", "coverage/**", "test/**", "vitest.config.ts"],
    },
  },
});
