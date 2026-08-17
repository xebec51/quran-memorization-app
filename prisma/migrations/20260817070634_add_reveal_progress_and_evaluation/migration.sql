-- AlterTable
ALTER TABLE "MemorizationQuestion" ADD COLUMN     "revealBoundaryVerseId" INTEGER,
ADD COLUMN     "revealTotalAyahCount" INTEGER,
ADD COLUMN     "revealedAyahCount" INTEGER NOT NULL DEFAULT 0;

-- Backfill: derive the page-boundary verse (last verse containing any word on
-- primaryPageNumber) and the total ayah count from anchorVerseId through that
-- boundary (inclusive) for every question created before this migration.
-- Mirrors the same generate-once-at-creation logic the service layer now
-- applies to new questions, so old and new rows share one invariant.
WITH boundary AS (
  SELECT
    q.id AS question_id,
    q."anchorVerseId" AS anchor_verse_id,
    (
      SELECT w."verseId"
      FROM "QuranWord" w
      WHERE w."pageNumber" = q."primaryPageNumber" AND w."charTypeName" = 'word'
      ORDER BY w."globalOrder" DESC
      LIMIT 1
    ) AS boundary_verse_id
  FROM "MemorizationQuestion" q
)
UPDATE "MemorizationQuestion" q
SET
  "revealBoundaryVerseId" = b.boundary_verse_id,
  "revealTotalAyahCount" = (
    SELECT COUNT(*)::int
    FROM "QuranVerse" v
    WHERE v."globalOrder" BETWEEN
      (SELECT "globalOrder" FROM "QuranVerse" WHERE id = b.anchor_verse_id)
      AND
      (SELECT "globalOrder" FROM "QuranVerse" WHERE id = b.boundary_verse_id)
  )
FROM boundary b
WHERE q.id = b.question_id;

ALTER TABLE "MemorizationQuestion" ALTER COLUMN "revealBoundaryVerseId" SET NOT NULL;
ALTER TABLE "MemorizationQuestion" ALTER COLUMN "revealTotalAyahCount" SET NOT NULL;

-- Defense in depth alongside the Zod/service-layer checks: these invariants
-- must never be violated regardless of which code path writes the row.
ALTER TABLE "MemorizationQuestion" ADD CONSTRAINT "MemorizationQuestion_revealedAyahCount_range"
  CHECK ("revealedAyahCount" >= 0 AND "revealedAyahCount" <= "revealTotalAyahCount");

-- CreateTable
CREATE TABLE "EvaluationAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "result" "RecallAssessment" NOT NULL,
    "belCount" INTEGER NOT NULL,
    "tuntunCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvaluationAttempt_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "EvaluationAttempt" ADD CONSTRAINT "EvaluationAttempt_belCount_nonnegative" CHECK ("belCount" >= 0);
ALTER TABLE "EvaluationAttempt" ADD CONSTRAINT "EvaluationAttempt_tuntunCount_nonnegative" CHECK ("tuntunCount" >= 0);

-- CreateIndex
CREATE INDEX "EvaluationAttempt_userId_createdAt_idx" ON "EvaluationAttempt"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "EvaluationAttempt_questionId_createdAt_idx" ON "EvaluationAttempt"("questionId", "createdAt");

-- CreateIndex
CREATE INDEX "EvaluationAttempt_userId_result_idx" ON "EvaluationAttempt"("userId", "result");

-- AddForeignKey
ALTER TABLE "EvaluationAttempt" ADD CONSTRAINT "EvaluationAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationAttempt" ADD CONSTRAINT "EvaluationAttempt_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "MemorizationQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
