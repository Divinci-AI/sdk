import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: ["tests/**/*.test.ts"],
		testTimeout: 10000,
		hookTimeout: 10000,
		// SAFETY: prevent system freeze with worker limits
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
