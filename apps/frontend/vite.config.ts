import { URL, fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/status/",
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@llm-pulse/shared": fileURLToPath(
        new URL("../../packages/shared/src/index.ts", import.meta.url),
      ),
    },
  },
  server: {
    port: 5173,
    host: "0.0.0.0",
    proxy: {
      "/status/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/status/health": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
