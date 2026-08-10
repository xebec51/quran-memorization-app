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
- Answer reveal and self-assessment: Benar, Sebagian benar, Belum ingat.
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
npm run test:e2e
npm run quran:sync
npm run quran:validate
npm run db:generate
npm run db:migrate
npm run db:deploy
npm run db:seed
```

## Quran Data

Arabic Uthmani text and metadata are synchronized from Quran Foundation's Content API using the official server SDK. The sync command imports chapters, pages, verses, words, page numbers, juz numbers, line metadata where available, and canonical ordering. `npm run quran:validate` fails loudly if structural invariants are violated.

## Memorization Algorithm

See [docs/memorization-engine.md](docs/memorization-engine.md). The key invariant is enforced both by pure algorithm tests and by the database uniqueness constraint `UNIQUE(cycleId, primaryPageNumber)`.

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
