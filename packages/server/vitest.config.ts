import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts", "src/index.ts"],
      thresholds: {
        lines: 80,
        branches: 75,
        functions: 85,
        statements: 80,
      },
    },
    testTimeout: 10000,
    hookTimeout: 10000,
    // SAFETY: Prevent system freeze with worker limits
    isolate: true,
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: false,
        maxThreads: 3,
        minThreads: 1,
        memoryLimit: "512MB",
      },
    },
  },
});
