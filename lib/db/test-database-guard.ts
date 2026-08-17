/**
 * Test/dev tooling (local e2e's dev server, integration tests, fixture
 * loading) must never be able to reach the real shared Neon database -
 * this happened for real once already: playwright.config.ts had no
 * DATABASE_URL override, `next dev` always loads .env.local regardless of
 * test context, and 186 test accounts accumulated in the real database
 * before it was caught (see docs/architecture.md "Local e2e Must Never
 * Touch the Shared Database"). This module is the single place that
 * decides whether a database URL is safe for that tooling to use.
 *
 * Deliberately NOT a Next.js/"server-only" module - it must be importable
 * from plain Node/tsx contexts (playwright.config.ts, vitest setup files,
 * standalone scripts), not just the app runtime.
 */

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1"]);

export const DEFAULT_LOCAL_TEST_DATABASE_URL =
  "postgresql://ci:ci@127.0.0.1:5433/ci";

export class UnsafeTestDatabaseUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeTestDatabaseUrlError";
  }
}

/**
 * Throws unless `url` is a syntactically valid Postgres connection string
 * whose host is localhost/127.0.0.1 and whose database name is present.
 * The hostname check is the real guarantee here: every real Neon (or any
 * other remote/production) connection string has a real DNS hostname, and
 * can never legitimately be "localhost" or "127.0.0.1" - so this alone is
 * sufficient to reject a Neon URL regardless of what database name it
 * uses. Returns the same url on success, for chaining into an assignment.
 */
export function assertLocalDatabaseUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UnsafeTestDatabaseUrlError(
      `Refusing to use an unparseable database URL for test/dev tooling: ${url}`
    );
  }
  if (!LOCAL_HOSTNAMES.has(parsed.hostname)) {
    throw new UnsafeTestDatabaseUrlError(
      `Refusing to use a non-local database for test/dev tooling: hostname "${parsed.hostname}" is not localhost/127.0.0.1. ` +
        "This must point at an isolated local Postgres, never a real or remote database (Neon or otherwise)."
    );
  }
  const databaseName = parsed.pathname.replace(/^\//, "");
  if (!databaseName) {
    throw new UnsafeTestDatabaseUrlError(
      "Refusing to use a database URL with no database name specified."
    );
  }
  return url;
}

/**
 * Resolves the database URL for test/dev tooling: uses `candidate` (pass
 * an explicit value for testing; defaults to process.env.TEST_DATABASE_URL)
 * if set, otherwise DEFAULT_LOCAL_TEST_DATABASE_URL - then validates
 * whichever one that is via assertLocalDatabaseUrl before returning it.
 *
 * Deliberately does NOT accept or fall back to DATABASE_URL: an
 * already-set DATABASE_URL in the ambient environment (a developer's
 * shell, a misconfigured CI step) is exactly the kind of value this
 * module exists to never trust implicitly.
 */
export function resolveTestDatabaseUrl(
  candidate: string | undefined = process.env.TEST_DATABASE_URL
): string {
  const url =
    candidate && candidate.length > 0
      ? candidate
      : DEFAULT_LOCAL_TEST_DATABASE_URL;
  return assertLocalDatabaseUrl(url);
}
