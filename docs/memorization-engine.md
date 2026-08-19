# Memorization Engine

The only difficulty is `Expert`. Difficulty is adjusted by user-requested hints, not by separate easy/medium/hard modes.

## Cycle

A cycle contains all 604 Madani Mushaf pages. A cycle plan has 151 packages with exactly four questions per package. Every primary question page appears once and only once in a cycle.

## Juz Bands

Pages are classified into:

- `A`: Juz 1-10
- `B`: Juz 11-20
- `C`: Juz 21-30

For boundary pages, classification uses the dominant juz among canonical page words. Ties resolve to the earliest juz on the page. Validation proves each band can supply one mandatory page per package.

## Wildcard Quotas

For each band:

`wildcardQuota = pagesInBand - 151`

The wildcard deck contains exactly those quota counts and is shuffled once per cycle. This avoids exhausting a band early.

## Package Construction

Each package consumes:

- one mandatory page from band A;
- one mandatory page from band B;
- one mandatory page from band C;
- one quota-safe wildcard page.

The four questions are shuffled so order does not reveal the band pattern.

## Fragment Selection

Question prompts choose a page-position bucket (`START`, `MIDDLE`, `END`) to vary where the tested page is represented. After the page area is selected, the generator chooses a suitable ayah whose beginning lies in, overlaps, or best represents that area.

The prompt itself always starts at the first word of the selected ayah. It never starts from the middle of an ayah or from an arbitrary word offset. The initial visible fragment is usually 4-7 contiguous canonical words when the ayah is long enough. Short ayat are shortened safely without combining unrelated text.

Selection is deterministic under an injected seeded RNG in tests and uses secure randomness in production allocation.

The generated visible prompt is stored as `visibleFragmentText` when the question is created. Canonical anchor ids, word counts, and Quran word references are still retained for integrity and for safe `EXTEND_FRAGMENT` continuation.

## Hints

Hints are independent:

- `JUZ`: reveals only `Juz N`, once.
- `SURAH`: reveals only the surah name, once.
- `EXTEND_FRAGMENT`: progressively increases visible contiguous words from the same ayah beginning, initially limited to 3 requests.
- `NEXT_VERSE`: reveals the next complete ayah by canonical order, initially limited to 3 requests. No longer exposed as a UI button in the main package view (redundant with progressive reveal itself, and with "Soal selesai dijawab" - see below) - the hint type, its API route, and historical `HintEvent` rows of this type are untouched, so this is a pure UI simplification, not a capability removal.

Hint-only pages never consume primary page eligibility.

## Progressive Reveal

Answer reveal is click-by-click, not a single "show answer" action. Each
click reveals exactly one more ayah, starting from the question's anchor
verse. The reveal boundary - how far a question can be revealed - is
`min(primaryPageNumber + 1, 604)`: reveal continues through the _entire
next Mushaf page_ after the question's primary page, not just to the end
of the primary page itself. A question anchored on page 1 reveals through
the last ayah touching page 2 (2:5), not just the last ayah touching page
1 (1:7). Page 604 has no next page, so `min(605, 604) = 604` naturally
caps the boundary at the end of the Quran with no separate branch needed.
An ayah is never cut at a page boundary - the boundary is always a whole
verse's `globalOrder`, computed once from `QuranWord.globalOrder`
following true canonical (chapter, verse, position) order (see
`lib/quran/sync/sync.ts`), never from provider-supplied word ids, which
are not monotonic across surah boundaries.

`revealBoundaryVerseId` and `revealTotalAyahCount` are computed once, at
question-generation time (`computeRevealBoundary`/
`computeRevealBoundariesBulk` in `lib/memorization/reveal/service.ts`),
and stored on the question - not recomputed on every click. Each reveal
click (`revealNextAyah`) is guarded by an `expectedRevealedCount`
optimistic-concurrency token: a duplicate click or network retry that
arrives after an earlier one already landed simply observes a mismatch
and returns the current state instead of advancing twice, and the whole
mutation runs inside a `Serializable` transaction. `nthVerseFromAnchor`
(the query behind every single-ayah reveal) is one round trip to
Postgres, not two - the anchor verse's `globalOrder` is looked up in a
subquery evaluated by Postgres itself rather than fetched client-side
first, since this runs on every click and is the hottest path in the app.

"Soal selesai dijawab" (`revealAll` in
`components/memorization/memorization-app.tsx`) does not bypass any of
this - it calls `POST /api/memorization/reveal-all`
(`revealAllRemainingAyahs` in `lib/memorization/reveal/service.ts`), for
a user who already answered from memory and doesn't want to click
through one ayah at a time. This was originally a client-side loop
calling the single-ayah reveal endpoint repeatedly, which meant a
question spanning many ayat cost that many sequential network round
trips and was the real source of the noticeable wait, not server latency
per click. `revealAllRemainingAyahs` instead reveals every remaining
ayah in one `Serializable` transaction and one round trip, via
`versesFromAnchor` (the bulk sibling of `nthVerseFromAnchor` - same
subquery-on-`globalOrder` shape, `LIMIT`ed to the remaining count instead
of 1). The answer still only ever arrives from the server after this
explicit request - nothing is sent ahead of what's been revealed, since
that would leak the hidden answer to network/dev-tools inspection before
the user has earned it; only how many ayat one authorized request is
allowed to return changed, not any access without a request.
`revealAllRemainingAyahs` needs no `expectedRevealedCount` token: unlike
advancing by exactly one ayah, "reveal everything remaining" converges to
the same final state regardless of the starting point, so it is
naturally idempotent under the transaction's isolation level rather than
needing its own optimistic-concurrency check.

Grading a question (`submitAssessment`) and switching to another question
in the same package are both rejected server-side - not just hidden in
the UI - until `revealedAyahCount >= revealTotalAyahCount`.
Self-assessment is objective MHQ-style scoring, not a subjective
three-way choice: the user reports `belCount` (bell rings) and
`tuntunCount` (prompts needed); the stored `assessment` enum is derived
(`deriveAssessment` in `lib/memorization/assessment.ts`, shared with
evaluation practice mode below so the two grading paths can never
diverge), not chosen - `belCount === 0 && tuntunCount === 0` is
`CORRECT`, anything else is `MISSED`. `PARTIAL` is never produced by a
new submission and remains a valid value only on historical
`QuestionAssessment` rows created before this change (see the schema
comment on that model) - those rows are never reinterpreted or
backfilled. A saved assessment is immutable: resubmitting the identical
`(belCount, tuntunCount)` pair replays the same result idempotently; a
different pair for an already-assessed question is a 409 conflict, never
a silent overwrite.

## Evaluation Practice Mode

Evaluation mode is separate, repeatable practice for questions whose
_current_ main-cycle assessment is `MISSED` or `PARTIAL` - never
`CORRECT` (rejected server-side even if the client's own bank listing is
bypassed). It reuses the progressive-reveal mechanics above, but against
its own state:

- The bank (`getEvaluationBank`) lists eligible questions without the
  page number, so the user cannot infer location before recalling from
  memory. It shows the question's **immutable initial fragment**
  (`fragmentStartWordId` + `initialWordCount`, fixed at question
  generation) - never the fragment as extended by an `EXTEND_FRAGMENT`
  hint during the main cycle, which would leak progress made outside this
  practice session.
- Reveal progress lives in its own `EvaluationSession` row
  (`(userId, questionId)` unique), completely separate from
  `MemorizationQuestion`'s own reveal columns - main-cycle reveal state is
  never touched by practicing a question here.
- Submitting an attempt (`submitEvaluationAttempt`) requires the session
  to be fully revealed first (409 `REVEAL_INCOMPLETE` otherwise) and
  requires integer `belCount`/`tuntunCount` >= 0, validated both
  client-side and server-side. Same objective bel/tuntun scoring as the
  main flow: the stored `result` is derived server-side from
  `belCount`/`tuntunCount` via the shared `deriveAssessment`
  (`lib/memorization/assessment.ts`) - the client never sends a `result`
  value, so a submission can never claim an outcome that contradicts its
  own bel/tuntun counts. Every attempt becomes a new `EvaluationAttempt`
  history row; it never changes the main-cycle `QuestionAssessment`. On
  success the `EvaluationSession` row is deleted so the next practice of
  the same question starts fully hidden again.
- Idempotency is scoped per user
  (`@@unique([userId, clientRequestId])`, a client-generated key resent
  unchanged on retry): replaying the same key with the same payload
  returns the original result; the same key with a different payload is a
  409 conflict, so a double-click or network retry can never duplicate an
  attempt or silently accept a different one under an already-used key.
- The bank and history are both cursor-paginated on a stable
  `(createdAt, id)` (history) or `(assessment desc, id asc)` (bank) pair,
  never loaded in full, so pagination never skips or duplicates rows as
  new attempts land between page fetches.
