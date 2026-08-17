-- Adds a nullable, unique client-generated idempotency key to
-- EvaluationAttempt so a double-click or network retry of the same
-- submission can be recognized and deduped instead of creating a second
-- history row (which would double-count belCount/tuntunCount).
--
-- Purely additive and safe against any amount of existing data: the
-- column is nullable, existing rows get NULL, and a Postgres unique index
-- permits any number of NULLs (NULL is never considered equal to NULL).

-- AlterTable
ALTER TABLE "EvaluationAttempt" ADD COLUMN "clientRequestId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationAttempt_clientRequestId_key" ON "EvaluationAttempt"("clientRequestId");
