-- Scope EvaluationAttempt's idempotency key to (userId, clientRequestId)
-- instead of a bare global unique on clientRequestId - additive/safe: any
-- existing non-null clientRequestId value is already globally unique, so
-- it is automatically unique per (userId, clientRequestId) too.
DROP INDEX "EvaluationAttempt_clientRequestId_key";
CREATE UNIQUE INDEX "EvaluationAttempt_userId_clientRequestId_key" ON "EvaluationAttempt"("userId", "clientRequestId");

-- Tracks in-progress progressive-reveal state for one (user, question)
-- evaluation practice session, deliberately separate from
-- MemorizationQuestion's own reveal columns (which belong to the main
-- 604-page cycle attempt).
CREATE TABLE "EvaluationSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "revealedAyahCount" INTEGER NOT NULL DEFAULT 0,
    "revealBoundaryVerseId" INTEGER NOT NULL,
    "revealTotalAyahCount" INTEGER NOT NULL,
    "revealedVersesJson" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvaluationSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EvaluationSession_userId_questionId_key" ON "EvaluationSession"("userId", "questionId");

ALTER TABLE "EvaluationSession" ADD CONSTRAINT "EvaluationSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EvaluationSession" ADD CONSTRAINT "EvaluationSession_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "MemorizationQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EvaluationSession" ADD CONSTRAINT "EvaluationSession_revealBoundaryVerseId_fkey" FOREIGN KEY ("revealBoundaryVerseId") REFERENCES "QuranVerse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EvaluationSession" ADD CONSTRAINT "EvaluationSession_revealedAyahCount_range"
  CHECK ("revealedAyahCount" >= 0 AND "revealedAyahCount" <= "revealTotalAyahCount");
