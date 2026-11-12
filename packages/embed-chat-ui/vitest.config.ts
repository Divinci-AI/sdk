import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 10000,
    hookTimeout: 10000,
    // SAFETY: worker limits (per repo convention) to avoid system freezes.
    isolate: true,
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: false,
        maxThreads: 2,
        minThreads: 1,
        memoryLimit: "512MB",
      },
    },
  },
});
