import { defineConfig, devices } from "@playwright/test";
import { resolveTestDatabaseUrl } from "./lib/db/test-database-guard";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: {
    timeout: 15_000
  },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:3210",
    trace: "on-first-retry"
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev -- -p 3210",
        url: "http://127.0.0.1:3210",
        reuseExistingServer: false,
        timeout: 120_000,
        // e2e creates and mutates real-looking user data (accounts,
        // cycles, assessments) on every run. `next dev` always loads
        // .env.local regardless of test context, and .env.local holds the
        // real shared Neon DATABASE_URL - without this override, every
        // local `npm run test:e2e` silently writes test data into that
        // database instead of an isolated one (this happened for real:
        // 186 test accounts accumulated there before this was caught).
        // resolveTestDatabaseUrl() reads ONLY TEST_DATABASE_URL (never
        // DATABASE_URL, never .env.local) and throws unless the resolved
        // value's host is localhost/127.0.0.1 - so this can never
        // silently end up pointed at Neon or any other remote database,
        // whether from an already-set DATABASE_URL in the ambient shell
        // or from a misconfigured CI step. CI sets TEST_DATABASE_URL
        // itself, validated by scripts/validate-test-database-url.ts
        // before anything downstream can write.
        env: {
          ...process.env,
          DATABASE_URL: resolveTestDatabaseUrl()
        } as Record<string, string>
      },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } }
  ]
});
