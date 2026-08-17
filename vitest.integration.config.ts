import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["./tests/integration/setup-env.ts"],
    // Migration + concurrency tests hit a real Postgres and seed/verify
    // meaningful row counts - slower than the pure-function unit suite.
    testTimeout: 30_000,
    hookTimeout: 30_000
  },
  resolve: {
    alias: {
      "@": new URL(".", import.meta.url).pathname
    }
  }
});
