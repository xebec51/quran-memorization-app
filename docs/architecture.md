# Architecture

Tasmiq is a Next.js App Router application with a domain-first backend for Musabaqah Hifzhil Qur'an preparation.

## Runtime Boundaries

Browser code receives only public challenge DTOs: question id, order, visible fragment, hint availability, reveal state, and assessment state. Surah, ayah, page, juz, anchor verse, ayah-start source metadata, and answer continuation remain in PostgreSQL until a user explicitly requests the corresponding hint or answer reveal. The visible prompt text is persisted separately from the canonical anchor references so ordinary question rendering does not need to reconstruct Quran words.

Quran Foundation credentials are read only by server-side scripts/provider code through `QF_CLIENT_ID`, `QF_CLIENT_SECRET`, and `QF_ENV`.

## Main Modules

- `lib/quran/provider`: Quran Foundation Content API provider abstraction.
- `lib/quran/sync`: explicit import command for chapters, pages, verses, and words - staged upsert, validation-gated commit, no long-lived table lock (see [Quran Data Integrity](quran-data-integrity.md)).
- `lib/quran/validation`: structural Quran-data validation and page-band classification.
- `lib/memorization/cycle`: pure shuffle-bag cycle planning.
- `lib/memorization/question`: fragment source selection.
- `lib/memorization/hint`: hint limits and public projections.
- `lib/memorization/reveal`: progressive per-ayah answer reveal, shared by the main cycle and evaluation practice.
- `lib/memorization/evaluation`: evaluation practice mode - bank, session, attempt submission, history (see [Memorization Engine](memorization-engine.md)).
- `lib/memorization/persistence-retry.ts`: retries a transaction only on a _verified_ transient Postgres conflict (serialization failure `40001`, deadlock `40P01`, or Prisma's own `P2034`) - never on a wrapper error class/name alone, which would mask a real bug behind minutes of pointless retries instead of surfacing it immediately.
- `lib/memorization/service.ts`: transactional user cycle/package/question persistence.
- `app/api/*`: Zod-validated route handlers with server-side authorization.

## Persistence

Prisma models normalize users, sessions, Quran chapters/pages/verses/words, cycles, packages, questions, hint events, and assessments. Database constraints enforce unique package numbers and `UNIQUE(cycleId, primaryPageNumber)` so a primary page cannot repeat within a cycle.

`EvaluationSession` (one row per `(userId, questionId)`) holds evaluation
practice's in-progress reveal state, deliberately separate from
`MemorizationQuestion`'s own reveal columns so practicing a question never
touches its main-cycle state. `EvaluationAttempt` records every graded
practice attempt as new history; it never updates `QuestionAssessment`.
Both idempotency keys (`EvaluationAttempt.clientRequestId`) and cursor
pagination on both tables are scoped per user, not global.

Hot memorization mutations return minimal DTOs. Assessment returns only the changed question id, selected assessment, and package completion state; hints return the new hint plus changed availability state, with fragment text included only for `EXTEND_FRAGMENT`.

API routes expose safe `Server-Timing` entries for session lookup and memorization hot paths. These timings contain durations only and never include credentials, connection strings, Quran Foundation secrets, or hidden answer metadata.

## Trust Boundary: Client IP Headers

`lib/auth/rate-limit.ts`'s `clientIp()` reads the `x-forwarded-for` (falling
back to `x-real-ip`) request header to key the per-IP login/register
throttle. **This is only safe because the app is deployed on Vercel**
(per `CLAUDE.md`): Vercel's edge network terminates every inbound
connection and sets `x-forwarded-for` itself from the real client
connection, overwriting rather than appending to any value a client
attempts to send directly - so a request that reaches this app's runtime
cannot forge its own IP through that header.

This assumption breaks if the app is ever run in an environment where
requests can reach the Next.js server without passing through a proxy
that enforces the same guarantee: for example, `next start` exposed
directly to the internet, or a reverse proxy/CDN in front of it that
forwards the header verbatim instead of setting it from the real peer
address. In either of those cases `x-forwarded-for` becomes
attacker-controlled input, and the per-IP throttle in `checkAndRecordAttempt`
(keyed by whatever value `clientIp()` returns) could be trivially bypassed
by sending a different forged value on every request. Local development
(`npm run dev`) has no such proxy either, so `clientIp()` there reflects
whatever a local client happens to send - harmless for solo local testing,
but not a boundary to rely on for anything security-sensitive locally.
If this app is ever deployed anywhere other than directly behind Vercel's
edge network, `clientIp()` must be revisited alongside whatever proxy
sits in front of it.

## Deployment

The app is Vercel-ready and Neon-compatible. Use the pooled Neon URL in `DATABASE_URL` for ordinary runtime traffic and the direct Neon URL in `DIRECT_URL` for Prisma migrations/admin access. Keep the Vercel function region and Neon database region geographically close.

## Local e2e Must Never Touch the Shared Database

`npm run test:e2e` starts its own `next dev` server
(`playwright.config.ts`'s `webServer`), and `next dev` always loads
`.env.local` regardless of test context - there is nothing Playwright- or
test-specific about that loading. Since `.env.local` holds the real
shared Neon `DATABASE_URL`, a `webServer` config with no explicit
override means every local e2e run silently registers real-looking
accounts, cycles, and assessments in the shared database. **This
happened**: 186 test-pattern accounts accumulated there across this
project's e2e runs before it was caught.

`webServer.env` now explicitly sets `DATABASE_URL` via
`resolveTestDatabaseUrl()` (`lib/db/test-database-guard.ts`), which reads
ONLY `TEST_DATABASE_URL` - never `DATABASE_URL`, never `.env.local` - and
throws unless the resolved value's hostname is `localhost`/`127.0.0.1`,
falling back to a fixed local default (`postgresql://ci:ci@127.0.0.1:5433/ci`)
when `TEST_DATABASE_URL` is unset. An already-set `DATABASE_URL` in the
ambient shell (a leftover export from an earlier `npm run dev`, a
misconfigured CI step) is deliberately never trusted, since that was the
exact class of gap the first version of this fix still had. `tests/integration/setup-env.ts`
uses the same function for `test:integration`, and CI's e2e job sets
`TEST_DATABASE_URL` (never `DATABASE_URL` directly) with a dedicated step
(`npm run db:validate-test-url`) that validates it and only then maps it
to `DATABASE_URL` for every downstream step. `scripts/load-quran-fixture.ts`
(unconditional `createMany`, no upsert safety - never safe against a
database with real rows) calls the same guard directly on its own
`DATABASE_URL` before writing anything. `tests/unit/test-database-guard.test.ts`
is a permanent regression test proving a Neon-shaped URL is rejected.

Any future change to `playwright.config.ts`, `setup-env.ts`, or the CI
workflow that bypasses `resolveTestDatabaseUrl()`/`assertLocalDatabaseUrl()`
reopens this hole - if a local e2e or integration run ever again has no
isolated database available, it must fail loudly (a thrown
`UnsafeTestDatabaseUrlError`, or a connection-refused once past
validation) rather than silently succeed against production.
