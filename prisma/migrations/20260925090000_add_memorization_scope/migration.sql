CREATE TYPE "MemorizationScope" AS ENUM ('THIRTY_JUZ', 'TWENTY_JUZ', 'TEN_JUZ');

ALTER TABLE "MemorizationCycle"
  ADD COLUMN "scope" "MemorizationScope" NOT NULL DEFAULT 'THIRTY_JUZ';

DROP INDEX "MemorizationCycle_userId_cycleNumber_key";

CREATE UNIQUE INDEX "MemorizationCycle_userId_scope_cycleNumber_key"
  ON "MemorizationCycle"("userId", "scope", "cycleNumber");

CREATE INDEX "MemorizationCycle_userId_scope_state_idx"
  ON "MemorizationCycle"("userId", "scope", "state");
