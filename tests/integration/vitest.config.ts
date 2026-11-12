import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Live-API tests: generous timeouts, strictly sequential so we don't
    // hammer staging or interleave stateful operations.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    sequence: { concurrent: false },
    fileParallelism: false,

    // REQUIRED: worker safety limits (see repo CLAUDE.md)
    isolate: true,
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: true,
        maxThreads: 1,
        minThreads: 1,
        memoryLimit: "512MB",
      },
    },
  },
});
