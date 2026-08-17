import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.ts"],
    // Integration tests hit a real Postgres and have their own config/
    // npm script (test:integration) - excluded here so plain `npm test`
    // stays a fast, DB-free pure-function suite runnable anywhere.
    exclude: ["node_modules/**", "tests/integration/**"],
    coverage: {
      reporter: ["text", "lcov"]
    }
  },
  resolve: {
    alias: {
      "@": new URL(".", import.meta.url).pathname
    }
  }
});
