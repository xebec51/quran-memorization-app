# Architecture

Tasmiq is a Next.js App Router application with a domain-first backend for Musabaqah Hifzhil Qur'an preparation.

## Runtime Boundaries

Browser code receives only public challenge DTOs: question id, order, visible fragment, hint availability, reveal state, and assessment state. Surah, ayah, page, juz, anchor verse, fragment offsets, and answer continuation remain in PostgreSQL until a user explicitly requests the corresponding hint or answer reveal.

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

## Deployment

The app is Vercel-ready and Neon-compatible. Use pooled URLs for ordinary runtime traffic and `DIRECT_URL` for direct database access when available.
