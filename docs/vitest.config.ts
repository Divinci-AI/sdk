import { defineConfig } from "vitest/config";

// Pure-function unit tests for the docs widget (src/components/docs-assistant/pure.ts).
// Node environment (no DOM); worker-safety limits per the repo CLAUDE.md.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    isolate: true,
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: false,
        maxThreads: 2,
        minThreads: 1,
      },
    },
  },
});
