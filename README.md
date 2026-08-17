# Tasmiq

Tasmiq — Latihan Musabaqah Hifzhil Qur'an.

Uji hafalan. Kenali kelemahan. Siapkan musabaqah.

A production-oriented Quran memorization web app in Bahasa Indonesia. The primary experience is Expert memorization testing with progressive hints, persistent cycles, history, analytics, and a simple Quran reader.

## Core Features

- Expert is the only memorization difficulty.
- Each package contains exactly 4 questions.
- Every package covers Juz 1-10, Juz 11-20, and Juz 21-30, plus one quota-safe wildcard.
- A full cycle consumes all 604 Madani Mushaf pages exactly once as primary question pages.
- Hints: Juz, Surah, progressive fragment extension, and next ayah.
- Question prompts always begin at the first word of the selected ayah while still varying the represented page area.
- Progressive answer reveal (one ayah per click, through the whole next Mushaf page) and self-assessment: Benar, Sebagian benar, Belum ingat.
- Evaluation practice mode: repeatable, page-hidden re-testing of any question last assessed Sebagian benar/Belum ingat, with its own reveal progress and attempt history.
- User-specific history and analytics.
- Quran reader by surah, juz, and page.

## Stack

Next.js App Router, React, TypeScript strict mode, Tailwind CSS, Prisma 7, PostgreSQL/Neon, local password authentication, Zod, Vitest, Playwright, ESLint, and the official Quran Foundation SDK `@quranjs/api`.

## Setup

```bash
npm install
cp .env.example .env.local
npm run db:deploy
npm run quran:sync
npm run dev
```

Required local environment:

- `DATABASE_URL` - runtime database URL. Use the Neon pooled URL in production.
- `DIRECT_URL` - Prisma migration/admin URL. Use the Neon direct URL in production.
- `AUTH_SECRET`
- `APP_URL`
- `QF_ENV=production`
- `QF_CLIENT_ID`
- `QF_CLIENT_SECRET`

Quran Foundation credentials must remain server-side and must never use `NEXT_PUBLIC_`.

## Commands

```bash
npm run dev
npm run build
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run test:e2e
npm run quran:sync
npm run quran:validate
npm run quran:validate-anchors
npm run db:generate
npm run db:migrate
npm run db:deploy
npm run db:seed
```

`npm run test:e2e` and `npm run test:integration` must run against an
isolated Postgres, never the shared Neon database - see
[Architecture: Local e2e Must Never Touch the Shared Database](docs/architecture.md#local-e2e-must-never-touch-the-shared-database).
Both resolve their database URL through `lib/db/test-database-guard.ts`,
which reads only `TEST_DATABASE_URL` (never `DATABASE_URL`, never
`.env.local`) and refuses to run at all against anything whose hostname
isn't `localhost`/`127.0.0.1`. Set `TEST_DATABASE_URL` explicitly to
point at your own isolated Postgres (e.g.
`TEST_DATABASE_URL=postgresql://ci:ci@127.0.0.1:5433/ci npm run
test:integration`); leaving it unset falls back to that same address by
default rather than skipping.

## Quran Data

Arabic Uthmani text and metadata are synchronized from Quran Foundation's Content API using the official server SDK. The sync command imports chapters, pages, verses, words, page numbers, juz numbers, line metadata where available, and canonical ordering. `npm run quran:validate` fails loudly if structural invariants are violated. See [docs/quran-data-integrity.md](docs/quran-data-integrity.md) for how sync stays safe to run against a live database (no long-held table lock, validation-gated commit, stale rows reported not deleted).

## Memorization Algorithm

See [docs/memorization-engine.md](docs/memorization-engine.md) for cycle/package construction, progressive answer reveal, and evaluation practice mode. The key invariant is enforced both by pure algorithm tests and by the database uniqueness constraint `UNIQUE(cycleId, primaryPageNumber)`.

## Security Notes

- Passwords are hashed with bcrypt.
- Sessions are stored as hashed random tokens in HTTP-only cookies.
- User-owned data is checked server-side in every route handler.
- Public question DTOs omit hidden metadata until a hint or answer reveal is requested.
- Quran Foundation secrets and database credentials are ignored by git via `.env*`.

## Documentation

- [Architecture](docs/architecture.md)
- [Memorization Engine](docs/memorization-engine.md)
- [Quran Data Integrity](docs/quran-data-integrity.md)

## Deployment

Deploy to Vercel with Neon PostgreSQL. Set `DATABASE_URL` to the pooled Neon URL for runtime traffic and `DIRECT_URL` to the direct Neon URL for Prisma migrations/admin operations. Run Prisma migrations during deployment, then run `npm run quran:sync` from a secure server-side environment. Do not place secrets in workflow YAML or client-exposed variables.

Check the Vercel function region and Neon database region before production launch. Keep them geographically close to reduce authenticated memorization latency.

## License

MIT. See [LICENSE](LICENSE).
