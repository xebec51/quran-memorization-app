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
    hookTimeout: 30_000,
    // Integration test files share ONE mutable database with no
    // per-file isolation, unlike the unit suite. Vitest's default
    // parallel-file execution let quran-sync.test.ts's bulk
    // upsertVerses (a heavy multi-row write) run concurrently with
    // another file's reads/writes on the same tables, producing a real
    // Postgres deadlock (40P01) - reproduced by running the full
    // integration suite together while it passed in isolation. Force
    // files to run one at a time instead of trying to make every
    // integration test independently concurrency-safe against a shared,
    // stateful database.
    fileParallelism: false
  },
  resolve: {
    alias: {
      "@": new URL(".", import.meta.url).pathname,
      // Next.js's bundler resolves "server-only" to its no-op empty.js
      // via the "react-server" export condition when building Server
      // Component code; a plain Vitest run never sets that condition, so
      // without this alias any module this suite imports that has
      // `import "server-only"` at its top (e.g.
      // lib/memorization/reveal/service.ts) would hit the package's
      // throwing default export instead.
      "server-only": new URL(
        "./node_modules/server-only/empty.js",
        import.meta.url
      ).pathname
    }
  }
});
