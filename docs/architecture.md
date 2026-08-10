# Architecture

Tasmiq is a Next.js App Router application with a domain-first backend for Musabaqah Hifzhil Qur'an preparation.

## Runtime Boundaries

Browser code receives only public challenge DTOs: question id, order, visible fragment, hint availability, reveal state, and assessment state. Surah, ayah, page, juz, anchor verse, ayah-start source metadata, and answer continuation remain in PostgreSQL until a user explicitly requests the corresponding hint or answer reveal. The visible prompt text is persisted separately from the canonical anchor references so ordinary question rendering does not need to reconstruct Quran words.

Quran Foundation credentials are read only by server-side scripts/provider code through `QF_CLIENT_ID`, `QF_CLIENT_SECRET`, and `QF_ENV`.

## Main Modules

- `lib/quran/provider`: Quran Foundation Content API provider abstraction.
- `lib/quran/sync`: explicit import command for chapters, pages, verses, and words.
- `lib/quran/validation`: structural Quran-data validation and page-band classification.
- `lib/memorization/cycle`: pure shuffle-bag cycle planning.
- `lib/memorization/question`: fragment source selection.
- `lib/memorization/hint`: hint limits and public projections.
- `lib/memorization/service.ts`: transactional user cycle/package/question persistence.
- `app/api/*`: Zod-validated route handlers with server-side authorization.

## Persistence

Prisma models normalize users, sessions, Quran chapters/pages/verses/words, cycles, packages, questions, hint events, and assessments. Database constraints enforce unique package numbers and `UNIQUE(cycleId, primaryPageNumber)` so a primary page cannot repeat within a cycle.

Hot memorization mutations return minimal DTOs. Assessment returns only the changed question id, selected assessment, and package completion state; hints return the new hint plus changed availability state, with fragment text included only for `EXTEND_FRAGMENT`.

API routes expose safe `Server-Timing` entries for session lookup and memorization hot paths. These timings contain durations only and never include credentials, connection strings, Quran Foundation secrets, or hidden answer metadata.

## Deployment

The app is Vercel-ready and Neon-compatible. Use the pooled Neon URL in `DATABASE_URL` for ordinary runtime traffic and the direct Neon URL in `DIRECT_URL` for Prisma migrations/admin access. Keep the Vercel function region and Neon database region geographically close.
