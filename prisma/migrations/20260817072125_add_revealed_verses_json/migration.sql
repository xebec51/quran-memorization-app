-- AlterTable
ALTER TABLE "MemorizationQuestion" ADD COLUMN     "revealedVersesJson" JSONB NOT NULL DEFAULT '[]';

-- Backfill: any question that already had an answer revealed under the old
-- single-shot "Lihat Jawaban" (answerRevealedAt set) is treated as fully
-- revealed under the new progressive system - the user already saw it, so
-- there is nothing left to hide, and re-hiding it on their next visit would
-- be a regression, not a privacy improvement. revealedAyahCount is set to
-- revealTotalAyahCount (already correct, backfilled by the previous
-- migration) and revealedVersesJson is populated with the actual verse text
-- for every ayah from the anchor through the page boundary.
UPDATE "MemorizationQuestion" q
SET
  "revealedAyahCount" = q."revealTotalAyahCount",
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
    FROM "QuranVerse" v
    JOIN "QuranChapter" c ON c.id = v."chapterId"
    WHERE v."globalOrder" BETWEEN
      (SELECT "globalOrder" FROM "QuranVerse" WHERE id = q."anchorVerseId")
      AND
      (SELECT "globalOrder" FROM "QuranVerse" WHERE id = q."revealBoundaryVerseId")
  )
WHERE q."answerRevealedAt" IS NOT NULL;
