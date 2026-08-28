-- CreateEnum
CREATE TYPE "StqhnCompetitionBranch" AS ENUM ('HIFZH_30_JUZ_INDEPENDENT', 'TAFSIR_ARABIC');

-- AlterTable
ALTER TABLE "MemorizationQuestion" ADD COLUMN     "stqhnQuestionId" TEXT,
ALTER COLUMN "cycleId" DROP NOT NULL,
ALTER COLUMN "packageId" DROP NOT NULL,
ALTER COLUMN "orderInPackage" DROP NOT NULL;

-- CreateTable
CREATE TABLE "StqhnQuestion" (
    "id" TEXT NOT NULL,
    "masterBankId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "competitionDay" INTEGER NOT NULL,
    "competitionBranch" "StqhnCompetitionBranch" NOT NULL,
    "questionType" TEXT NOT NULL,
    "participantDisplayNo" INTEGER NOT NULL,
    "questionNoForParticipant" INTEGER NOT NULL,
    "timestampStart" TEXT NOT NULL,
    "timestampStartSec" DOUBLE PRECISION NOT NULL,
    "timestampEnd" TEXT,
    "timestampEndSec" DOUBLE PRECISION,
    "startVerseKey" TEXT NOT NULL,
    "endVerseKey" TEXT NOT NULL,
    "passageRange" TEXT NOT NULL,
    "startWordIndex" INTEGER NOT NULL,
    "startsAtVerseBeginning" BOOLEAN NOT NULL,
    "confidence" TEXT NOT NULL,
    "audioReviewNeeded" BOOLEAN NOT NULL,
    "auditNote" TEXT NOT NULL,
    "sourceTranscript" TEXT,
    "sourceYoutubeUrl" TEXT NOT NULL,
    "anchorVerseId" INTEGER NOT NULL,
    "fragmentStartWordId" INTEGER NOT NULL,
    "initialWordCount" INTEGER NOT NULL,
    "fragmentText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StqhnQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StqhnQuestion_masterBankId_key" ON "StqhnQuestion"("masterBankId");

-- CreateIndex
CREATE UNIQUE INDEX "StqhnQuestion_questionId_key" ON "StqhnQuestion"("questionId");

-- CreateIndex
CREATE INDEX "StqhnQuestion_videoId_idx" ON "StqhnQuestion"("videoId");

-- CreateIndex
CREATE INDEX "StqhnQuestion_competitionBranch_idx" ON "StqhnQuestion"("competitionBranch");

-- CreateIndex
CREATE INDEX "StqhnQuestion_anchorVerseId_idx" ON "StqhnQuestion"("anchorVerseId");

-- CreateIndex
CREATE UNIQUE INDEX "MemorizationQuestion_userId_stqhnQuestionId_key" ON "MemorizationQuestion"("userId", "stqhnQuestionId");

-- AddForeignKey
ALTER TABLE "MemorizationQuestion" ADD CONSTRAINT "MemorizationQuestion_stqhnQuestionId_fkey" FOREIGN KEY ("stqhnQuestionId") REFERENCES "StqhnQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StqhnQuestion" ADD CONSTRAINT "StqhnQuestion_anchorVerseId_fkey" FOREIGN KEY ("anchorVerseId") REFERENCES "QuranVerse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StqhnQuestion" ADD CONSTRAINT "StqhnQuestion_fragmentStartWordId_fkey" FOREIGN KEY ("fragmentStartWordId") REFERENCES "QuranWord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

