ALTER TABLE "MemorizationQuestion" ADD COLUMN "visibleFragmentText" TEXT;

UPDATE "MemorizationQuestion" AS question
SET "visibleFragmentText" = COALESCE(fragment."text", '')
FROM (
  SELECT
    question."id",
    string_agg(word."textUthmani", ' ' ORDER BY word."position") AS "text"
  FROM "MemorizationQuestion" AS question
  JOIN "QuranWord" AS word
    ON word."verseId" = question."anchorVerseId"
   AND word."charTypeName" = 'word'
   AND word."position" <= question."visibleWordCount"
  GROUP BY question."id"
) AS fragment
WHERE question."id" = fragment."id";

ALTER TABLE "MemorizationQuestion" ALTER COLUMN "visibleFragmentText" SET NOT NULL;

CREATE INDEX "MemorizationQuestion_userId_juzBand_idx" ON "MemorizationQuestion"("userId", "juzBand");
CREATE INDEX "MemorizationQuestion_userId_primaryPageNumber_idx" ON "MemorizationQuestion"("userId", "primaryPageNumber");
CREATE INDEX "HintEvent_userId_type_idx" ON "HintEvent"("userId", "type");
CREATE INDEX "QuestionAssessment_userId_assessment_idx" ON "QuestionAssessment"("userId", "assessment");
