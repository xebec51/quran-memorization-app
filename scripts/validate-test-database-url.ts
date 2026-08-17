import { resolveTestDatabaseUrl } from "../lib/db/test-database-guard";

/**
 * CI-only gate: validates TEST_DATABASE_URL is safe (local, not Neon/any
 * remote host) BEFORE the workflow maps it to DATABASE_URL for every
 * downstream write step (db:deploy, quran:load-fixture, test:integration,
 * test:e2e). Exits non-zero on an unsafe value, which fails the CI step
 * before any of those steps can run - see .github/workflows/ci.yml.
 */
try {
  const url = resolveTestDatabaseUrl();
  process.stdout.write(`TEST_DATABASE_URL is safe: ${new URL(url).host}\n`);
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "TEST_DATABASE_URL validation failed"}\n`
  );
  process.exit(1);
}
