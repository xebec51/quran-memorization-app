-- CreateTable
CREATE TABLE "StqhnPackage" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "competitionBranch" "StqhnCompetitionBranch" NOT NULL,
    "participantDisplayNo" INTEGER NOT NULL,
    "competitionDay" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StqhnPackage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StqhnPackage_competitionBranch_idx" ON "StqhnPackage"("competitionBranch");

-- CreateIndex
CREATE UNIQUE INDEX "StqhnPackage_videoId_competitionBranch_participantDisplayNo_key" ON "StqhnPackage"("videoId", "competitionBranch", "participantDisplayNo");

-- AlterTable (nullable for now - backfilled below, then tightened)
ALTER TABLE "StqhnQuestion" ADD COLUMN "stqhnPackageId" TEXT;

-- Backfill: one StqhnPackage per existing (videoId, competitionBranch,
-- participantDisplayNo) group of already-imported StqhnQuestion rows.
-- This 3-part key (not participantDisplayNo alone) is required: the real
-- source data shows HIFZH_30_JUZ_INDEPENDENT and TAFSIR_ARABIC records
-- within the same video independently number their own
-- participant/day counters from 1, so the same numeric value can denote
-- two entirely unrelated groups without competitionBranch to
-- disambiguate (verified against the full 372-record export - grouping
-- by this 3-part key yields exactly 93 groups of exactly 4 questions
-- each, a clean partition, vs. spurious cross-branch collisions on
-- (videoId, participantDisplayNo) alone).
INSERT INTO "StqhnPackage" ("id", "videoId", "competitionBranch", "participantDisplayNo", "competitionDay", "createdAt", "updatedAt")
SELECT
  md5(random()::text || clock_timestamp()::text || "videoId" || "competitionBranch"::text || "participantDisplayNo"::text),
  "videoId",
  "competitionBranch",
  "participantDisplayNo",
  MIN("competitionDay"),
  now(),
  now()
FROM "StqhnQuestion"
GROUP BY "videoId", "competitionBranch", "participantDisplayNo";

-- Backfill stqhnPackageId on every existing StqhnQuestion row.
UPDATE "StqhnQuestion" AS sq
SET "stqhnPackageId" = sp."id"
FROM "StqhnPackage" AS sp
WHERE sp."videoId" = sq."videoId"
  AND sp."competitionBranch" = sq."competitionBranch"
  AND sp."participantDisplayNo" = sq."participantDisplayNo";

-- AlterTable: every row is backfilled now (verified above), enforce NOT NULL.
ALTER TABLE "StqhnQuestion" ALTER COLUMN "stqhnPackageId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "StqhnQuestion_stqhnPackageId_idx" ON "StqhnQuestion"("stqhnPackageId");

-- AddForeignKey
ALTER TABLE "StqhnQuestion" ADD CONSTRAINT "StqhnQuestion_stqhnPackageId_fkey" FOREIGN KEY ("stqhnPackageId") REFERENCES "StqhnPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
