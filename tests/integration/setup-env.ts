import { resolveTestDatabaseUrl } from "../../lib/db/test-database-guard";

/**
 * lib/db/prisma.ts reads process.env.DATABASE_URL at module-import time, so
 * any test that exercises real service code (not just raw `pg` queries, as
 * reveal-boundary-migration.test.ts does) needs DATABASE_URL pointed at a
 * validated-safe database BEFORE that module loads. Vitest runs setupFiles
 * before a test file's own imports resolve, so this rewrite lands in time.
 *
 * resolveTestDatabaseUrl() never falls back to an already-set DATABASE_URL
 * and never reads .env.local - it only trusts TEST_DATABASE_URL, or a
 * fixed local default, and throws if the resolved value isn't genuinely
 * local. A throw here fails the whole integration run immediately and
 * loudly (Vitest surfaces a setup-file error), rather than silently
 * letting DATABASE_URL resolve to whatever the ambient environment
 * happens to provide.
 */
process.env.DATABASE_URL = resolveTestDatabaseUrl();
