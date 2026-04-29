import { URL, fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import type { PluginOption } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react() as unknown as PluginOption],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@llm-pulse/shared": fileURLToPath(
        new URL("../../packages/shared/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      reporter: ["text", "html", "lcov", "json"],
      thresholds: {
        lines: 30,
        functions: 30,
        branches: 20,
        statements: 30,
      },
      exclude: ["dist/**", "coverage/**", "src/test/**", "vitest.config.ts"],
    },
  },
});
