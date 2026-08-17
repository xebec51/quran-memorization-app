-- Corrective, additive-only migration. Does not touch "User",
-- "MemorizationCycle", "MemorizationPackage", "QuestionAssessment",
-- "HintEvent", "EvaluationAttempt", any id/timestamp column, or the
-- "state" column - only the four reveal-progress columns on
-- "MemorizationQuestion" (revealBoundaryVerseId, revealTotalAyahCount,
-- revealedAyahCount, revealedVersesJson), and only where a value actually
-- needs to change. No row is deleted or reset; no table is truncated.
--
-- Bug fixed: progressive reveal was required to continue through the
-- ENTIRE Mushaf page after the question's primary page (boundary page =
-- LEAST(primaryPageNumber + 1, 604)), but both the original service-layer
-- implementation and its matching backfill (migration
-- 20260817070634_add_reveal_progress_and_evaluation) computed the
-- boundary using primaryPageNumber itself - e.g. a page-1 question
-- stopped at 1:7 instead of continuing through 2:5. Verified against live
-- data before writing this migration (page 1 -> 2:5, page 2 -> 2:16, page
-- 603 -> 114:6 all match the corrected formula, none match the old one).
--
-- This recomputes revealBoundaryVerseId/revealTotalAyahCount from CURRENT
-- QuranVerse/QuranWord data for every row, independent of quran:sync
-- execution order or any previously stored value - so it also
-- transparently fixes any row whose boundary was additionally wrong
-- because of the historical QuranWord.globalOrder canonical-ordering bug
-- (fixed separately in migration/commit "082ced1"), not just the
-- page+1 bug, without needing to enumerate which pages were affected.

-- Step 1: recompute the boundary verse and total ayah count for every
-- question. This alone only ever changes how many ayat REMAIN to reveal
-- going forward - it never touches revealedAyahCount, so it cannot affect
-- already-ASSESSED questions' completion status or require anyone to
-- redo anything already done.
WITH corrected AS (
  SELECT
    q.id AS question_id,
    lw."verseId" AS boundary_verse_id,
    (bv."globalOrder" - av."globalOrder" + 1) AS total_ayah_count
  FROM "MemorizationQuestion" q
  JOIN "QuranVerse" av ON av.id = q."anchorVerseId"
  JOIN LATERAL (
    SELECT w."verseId"
    FROM "QuranWord" w
    WHERE w."pageNumber" = LEAST(q."primaryPageNumber" + 1, 604)
      AND w."charTypeName" = 'word'
    ORDER BY w."globalOrder" DESC
    LIMIT 1
  ) lw ON true
  JOIN "QuranVerse" bv ON bv.id = lw."verseId"
)
UPDATE "MemorizationQuestion" q
SET
  "revealBoundaryVerseId" = c.boundary_verse_id,
  "revealTotalAyahCount" = c.total_ayah_count
FROM corrected c
WHERE q.id = c.question_id
  AND (
    q."revealBoundaryVerseId" IS DISTINCT FROM c.boundary_verse_id
    OR q."revealTotalAyahCount" IS DISTINCT FROM c.total_ayah_count
  );

-- Step 2: correct revealedAyahCount/revealedVersesJson for exactly two
-- cases, leaving every other row completely untouched:
--
-- (a) Legacy over-claim: migration 20260817072125 retroactively marked
--     every pre-progressive-reveal "Lihat Jawaban" question
--     (answerRevealedAt set, created before that migration ran) as having
--     revealed its entire boundary range. The old single-shot reveal
--     never showed more than 3 ayat, so cap to that instead of
--     fabricating history. This never affects assessment: an
--     already-ASSESSED question stays ASSESSED and requires no further
--     action, because submitAssessment's reveal-completeness check only
--     runs when a NEW assessment is being submitted, never retroactively
--     against history.
-- (b) Defensive clamp: revealedAyahCount can never be left greater than
--     the corrected revealTotalAyahCount, or the pre-existing CHECK
--     constraint "MemorizationQuestion_revealedAyahCount_range" would be
--     violated. The corrected (page + 1) boundary is always at or beyond
--     the old (same-page) boundary for every page except 604 (where the
--     formula is unchanged), so this is not expected to change any real
--     row - it exists as a proven guarantee, not an assumption.
-- Detection is deliberately just answerRevealedAt + createdAt, matching
-- migration 20260817072125's own WHERE clause exactly (it applied to
-- every row with answerRevealedAt set, unconditionally) - NOT a
-- comparison against revealTotalAyahCount, because Step 1 above has
-- already overwritten that column with the corrected (larger) value by
-- the time this CTE runs, so comparing against it here would compare
-- against the new total instead of detecting the old over-claim.
WITH needs_correction AS (
  SELECT
    q.id AS question_id,
    CASE
      WHEN q."answerRevealedAt" IS NOT NULL
        AND q."createdAt" < TIMESTAMP '2026-08-17 07:21:25'
        THEN LEAST(3, q."revealTotalAyahCount")
      ELSE LEAST(q."revealedAyahCount", q."revealTotalAyahCount")
    END AS target_count
  FROM "MemorizationQuestion" q
)
UPDATE "MemorizationQuestion" q
SET
  "revealedAyahCount" = nc.target_count,
  "revealedVersesJson" = (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'verseKey', v."verseKey",
          'text', v."textUthmani",
          'surah', c."nameTransliterated" || ' (' || c."nameArabic" || ')',
          'juz', v."juzNumber",
          'page', v."pageNumber"
        )
        ORDER BY v."globalOrder"
      ),
      '[]'::jsonb
    )
    FROM (
      SELECT *
      FROM "QuranVerse"
      WHERE "globalOrder" >=
        (SELECT "globalOrder" FROM "QuranVerse" WHERE id = q."anchorVerseId")
      ORDER BY "globalOrder"
      LIMIT nc.target_count
    ) v
    JOIN "QuranChapter" c ON c.id = v."chapterId"
  )
FROM needs_correction nc
WHERE q.id = nc.question_id
  AND nc.target_count IS DISTINCT FROM q."revealedAyahCount";
