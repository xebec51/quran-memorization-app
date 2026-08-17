-- Verified against live data before writing this migration: 0 rows have an
-- anchorVerseId/fragmentStartWordId/revealBoundaryVerseId that doesn't
-- reference a real QuranVerse/QuranWord, and 0 rows share the same
-- (cycleId, anchorVerseId) pair, so these constraints are safe to add.
--
-- 56 pre-existing questions (all created 2026-08-10, the very first batch)
-- have a fragmentStartWordId that is NOT the first word of its verse -
-- a historical generator bug that predates this migration. That is a
-- semantic invariant these foreign keys/unique index cannot express (it
-- requires comparing against QuranWord.position, not just existence/
-- uniqueness), so it is checked separately and non-destructively by
-- lib/memorization/validation.ts / scripts/validate-question-anchors.ts
-- instead of being enforced here - those 56 rows were already answered by
-- real users and are not rewritten.

-- AddForeignKey
ALTER TABLE "MemorizationQuestion" ADD CONSTRAINT "MemorizationQuestion_anchorVerseId_fkey" FOREIGN KEY ("anchorVerseId") REFERENCES "QuranVerse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemorizationQuestion" ADD CONSTRAINT "MemorizationQuestion_fragmentStartWordId_fkey" FOREIGN KEY ("fragmentStartWordId") REFERENCES "QuranWord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemorizationQuestion" ADD CONSTRAINT "MemorizationQuestion_revealBoundaryVerseId_fkey" FOREIGN KEY ("revealBoundaryVerseId") REFERENCES "QuranVerse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "MemorizationQuestion_cycleId_anchorVerseId_key" ON "MemorizationQuestion"("cycleId", "anchorVerseId");
