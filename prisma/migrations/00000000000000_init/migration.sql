CREATE TYPE "CycleState" AS ENUM ('ACTIVE', 'COMPLETED');
CREATE TYPE "PackageState" AS ENUM ('IN_PROGRESS', 'COMPLETED');
CREATE TYPE "QuestionState" AS ENUM ('ACTIVE', 'ANSWER_REVEALED', 'ASSESSED');
CREATE TYPE "JuzBand" AS ENUM ('A', 'B', 'C');
CREATE TYPE "PagePositionBucket" AS ENUM ('START', 'MIDDLE', 'END');
CREATE TYPE "HintType" AS ENUM ('JUZ', 'SURAH', 'EXTEND_FRAGMENT', 'NEXT_VERSE');
CREATE TYPE "RecallAssessment" AS ENUM ('CORRECT', 'PARTIAL', 'MISSED');

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT,
  "passwordHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Session" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuranChapter" (
  "id" INTEGER NOT NULL,
  "nameArabic" TEXT NOT NULL,
  "nameSimple" TEXT NOT NULL,
  "nameTransliterated" TEXT NOT NULL,
  "translatedName" TEXT,
  "versesCount" INTEGER NOT NULL,
  "revelationPlace" TEXT,
  "bismillahPre" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "QuranChapter_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuranPage" (
  "pageNumber" INTEGER NOT NULL,
  "juzBand" "JuzBand" NOT NULL,
  "firstJuz" INTEGER NOT NULL,
  "lastJuz" INTEGER NOT NULL,
  "wordCount" INTEGER NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'quran-foundation-content-api',
  CONSTRAINT "QuranPage_pkey" PRIMARY KEY ("pageNumber")
);

CREATE TABLE "QuranVerse" (
  "id" INTEGER NOT NULL,
  "verseKey" TEXT NOT NULL,
  "chapterId" INTEGER NOT NULL,
  "verseNumber" INTEGER NOT NULL,
  "globalOrder" INTEGER NOT NULL,
  "juzNumber" INTEGER NOT NULL,
  "pageNumber" INTEGER NOT NULL,
  "textUthmani" TEXT NOT NULL,
  "textUthmaniSimple" TEXT,
  CONSTRAINT "QuranVerse_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuranWord" (
  "id" INTEGER NOT NULL,
  "verseId" INTEGER NOT NULL,
  "verseKey" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "globalOrder" INTEGER NOT NULL,
  "pageNumber" INTEGER NOT NULL,
  "lineNumber" INTEGER,
  "textUthmani" TEXT NOT NULL,
  "charTypeName" TEXT NOT NULL,
  "location" TEXT,
  CONSTRAINT "QuranWord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuranSyncRun" (
  "id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "status" TEXT NOT NULL,
  "message" TEXT,
  "chapters" INTEGER NOT NULL DEFAULT 0,
  "pages" INTEGER NOT NULL DEFAULT 0,
  "verses" INTEGER NOT NULL DEFAULT 0,
  "words" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "QuranSyncRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MemorizationCycle" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "cycleNumber" INTEGER NOT NULL,
  "state" "CycleState" NOT NULL DEFAULT 'ACTIVE',
  "seed" TEXT NOT NULL,
  "plan" JSONB NOT NULL,
  "nextPackageNo" INTEGER NOT NULL DEFAULT 1,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MemorizationCycle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MemorizationPackage" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "cycleId" TEXT NOT NULL,
  "packageNumber" INTEGER NOT NULL,
  "state" "PackageState" NOT NULL DEFAULT 'IN_PROGRESS',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MemorizationPackage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MemorizationQuestion" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "cycleId" TEXT NOT NULL,
  "packageId" TEXT NOT NULL,
  "orderInPackage" INTEGER NOT NULL,
  "state" "QuestionState" NOT NULL DEFAULT 'ACTIVE',
  "primaryPageNumber" INTEGER NOT NULL,
  "juzNumber" INTEGER NOT NULL,
  "juzBand" "JuzBand" NOT NULL,
  "surahId" INTEGER NOT NULL,
  "anchorVerseId" INTEGER NOT NULL,
  "anchorVerseKey" TEXT NOT NULL,
  "pagePositionBucket" "PagePositionBucket" NOT NULL,
  "fragmentStartWordId" INTEGER NOT NULL,
  "initialWordCount" INTEGER NOT NULL,
  "visibleWordCount" INTEGER NOT NULL,
  "maxExtensionCount" INTEGER NOT NULL DEFAULT 3,
  "maxNextVerseCount" INTEGER NOT NULL DEFAULT 3,
  "answerRevealedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MemorizationQuestion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HintEvent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "questionId" TEXT NOT NULL,
  "type" "HintType" NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HintEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuestionAssessment" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "questionId" TEXT NOT NULL,
  "assessment" "RecallAssessment" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QuestionAssessment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");
CREATE INDEX "QuranPage_juzBand_idx" ON "QuranPage"("juzBand");
CREATE UNIQUE INDEX "QuranVerse_verseKey_key" ON "QuranVerse"("verseKey");
CREATE UNIQUE INDEX "QuranVerse_globalOrder_key" ON "QuranVerse"("globalOrder");
CREATE UNIQUE INDEX "QuranVerse_chapterId_verseNumber_key" ON "QuranVerse"("chapterId", "verseNumber");
CREATE INDEX "QuranVerse_pageNumber_globalOrder_idx" ON "QuranVerse"("pageNumber", "globalOrder");
CREATE INDEX "QuranVerse_juzNumber_idx" ON "QuranVerse"("juzNumber");
CREATE UNIQUE INDEX "QuranWord_globalOrder_key" ON "QuranWord"("globalOrder");
CREATE UNIQUE INDEX "QuranWord_verseId_position_key" ON "QuranWord"("verseId", "position");
CREATE INDEX "QuranWord_pageNumber_globalOrder_idx" ON "QuranWord"("pageNumber", "globalOrder");
CREATE INDEX "QuranWord_verseKey_idx" ON "QuranWord"("verseKey");
CREATE UNIQUE INDEX "MemorizationCycle_userId_cycleNumber_key" ON "MemorizationCycle"("userId", "cycleNumber");
CREATE INDEX "MemorizationCycle_userId_state_idx" ON "MemorizationCycle"("userId", "state");
CREATE UNIQUE INDEX "MemorizationPackage_cycleId_packageNumber_key" ON "MemorizationPackage"("cycleId", "packageNumber");
CREATE INDEX "MemorizationPackage_userId_createdAt_idx" ON "MemorizationPackage"("userId", "createdAt");
CREATE UNIQUE INDEX "MemorizationQuestion_cycleId_primaryPageNumber_key" ON "MemorizationQuestion"("cycleId", "primaryPageNumber");
CREATE UNIQUE INDEX "MemorizationQuestion_packageId_orderInPackage_key" ON "MemorizationQuestion"("packageId", "orderInPackage");
CREATE INDEX "MemorizationQuestion_userId_createdAt_idx" ON "MemorizationQuestion"("userId", "createdAt");
CREATE INDEX "MemorizationQuestion_anchorVerseId_idx" ON "MemorizationQuestion"("anchorVerseId");
CREATE UNIQUE INDEX "HintEvent_questionId_type_ordinal_key" ON "HintEvent"("questionId", "type", "ordinal");
CREATE INDEX "HintEvent_userId_createdAt_idx" ON "HintEvent"("userId", "createdAt");
CREATE UNIQUE INDEX "QuestionAssessment_questionId_key" ON "QuestionAssessment"("questionId");
CREATE INDEX "QuestionAssessment_userId_createdAt_idx" ON "QuestionAssessment"("userId", "createdAt");

ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuranVerse" ADD CONSTRAINT "QuranVerse_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "QuranChapter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QuranVerse" ADD CONSTRAINT "QuranVerse_pageNumber_fkey" FOREIGN KEY ("pageNumber") REFERENCES "QuranPage"("pageNumber") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QuranWord" ADD CONSTRAINT "QuranWord_verseId_fkey" FOREIGN KEY ("verseId") REFERENCES "QuranVerse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuranWord" ADD CONSTRAINT "QuranWord_pageNumber_fkey" FOREIGN KEY ("pageNumber") REFERENCES "QuranPage"("pageNumber") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MemorizationCycle" ADD CONSTRAINT "MemorizationCycle_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemorizationPackage" ADD CONSTRAINT "MemorizationPackage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemorizationPackage" ADD CONSTRAINT "MemorizationPackage_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "MemorizationCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemorizationQuestion" ADD CONSTRAINT "MemorizationQuestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemorizationQuestion" ADD CONSTRAINT "MemorizationQuestion_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "MemorizationCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemorizationQuestion" ADD CONSTRAINT "MemorizationQuestion_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "MemorizationPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemorizationQuestion" ADD CONSTRAINT "MemorizationQuestion_primaryPageNumber_fkey" FOREIGN KEY ("primaryPageNumber") REFERENCES "QuranPage"("pageNumber") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HintEvent" ADD CONSTRAINT "HintEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HintEvent" ADD CONSTRAINT "HintEvent_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "MemorizationQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuestionAssessment" ADD CONSTRAINT "QuestionAssessment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuestionAssessment" ADD CONSTRAINT "QuestionAssessment_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "MemorizationQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
