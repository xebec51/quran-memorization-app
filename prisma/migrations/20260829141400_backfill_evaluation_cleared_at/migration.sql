-- One-time data backfill for evaluationClearedAt (added by
-- 20260828112226_add_evaluation_cleared_at). That migration only added
-- the column - it never populated it from history, so any question
-- whose most recent EvaluationAttempt was already CORRECT before this
-- column existed stayed NULL (still "needs re-evaluation") even though
-- the user had already passed it. This was made worse in production
-- specifically: the app was deployed expecting this column for roughly
-- a day before `prisma migrate deploy` was wired into the build (see
-- the vercel-build migration), so during that window every
-- submitEvaluationAttempt call's trailing update to this column failed
-- (P2022 column-does-not-exist) and rolled back the whole transaction -
-- except any attempt that had already completed and been recorded
-- *before* this column was added to the schema at all, which is exactly
-- the case this backfill needs to catch up.
--
-- For each question, look at its single most recent EvaluationAttempt
-- (DISTINCT ON ... ORDER BY createdAt DESC, matching the "latest
-- attempt decides bank membership" rule in getEvaluationBank/
-- submitEvaluationAttempt) and stamp evaluationClearedAt with that
-- attempt's createdAt when the result is CORRECT. Questions whose
-- latest attempt is not CORRECT are left alone - evaluationClearedAt
-- already defaults to NULL for them, which is correct. Idempotent: safe
-- to run again if ever needed.
UPDATE "MemorizationQuestion" q
SET "evaluationClearedAt" = latest."createdAt"
FROM (
  SELECT DISTINCT ON ("questionId") "questionId", "createdAt", "result"
  FROM "EvaluationAttempt"
  ORDER BY "questionId", "createdAt" DESC
) latest
WHERE q.id = latest."questionId"
  AND latest."result" = 'CORRECT';
