CREATE INDEX "QuranWord_verseId_globalOrder_idx" ON "QuranWord"("verseId", "globalOrder");
CREATE INDEX "MemorizationPackage_userId_state_createdAt_idx" ON "MemorizationPackage"("userId", "state", "createdAt");
CREATE INDEX "HintEvent_questionId_type_idx" ON "HintEvent"("questionId", "type");
