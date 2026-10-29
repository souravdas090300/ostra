import { defineConfig } from "vitest/config";
import path from "path";
import { loadEnv } from "vite";

export default defineConfig(({ mode }) => ({
  test: {
    globals: true,
    environment: "node",
    fileParallelism: false,
    env: loadEnv("test", process.cwd(), ""),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
}));
