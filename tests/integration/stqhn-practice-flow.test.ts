import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Proves the STQHN 2025 integration reuses the existing memorization/
 * evaluation machinery end to end, with zero new evaluation logic:
 * selecting a bank question creates a real MemorizationQuestion
 * (lib/memorization/stqhn/service.ts's getOrCreateStqhnAttempt), grading
 * it wrong uses the same submitAssessment as the main cycle, a MISSED
 * result surfaces in the exact same Evaluation Bank query with no
 * STQHN-specific carve-out, and re-practicing it to a clean 0/0 uses the
 * exact same EvaluationSession/EvaluationAttempt loop - never overwriting
 * the original main-cycle assessment, so the question stays retestable
 * indefinitely, exactly like a main-cycle MISSED question already does.
 *
 * Requires a real Postgres with the full canonical Quran dataset loaded
 * via TEST_DATABASE_URL or DATABASE_URL; skips cleanly if neither is set.
 * See tests/integration/setup-env.ts for how TEST_DATABASE_URL is safely
 * swapped into lib/db/prisma.ts's module-load-time DATABASE_URL read
 * before this file's own imports (which pull in the real `prisma`
 * client and every lib/memorization/* function under test) resolve.
 */
const connectionString =
  process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

const run = connectionString ? describe : describe.skip;

run(
  "STQHN 2025 practice flow reuses existing memorization/evaluation machinery",
  () => {
    const runId = randomUUID().slice(0, 8);
    const userId = `test-stqhn-user-${runId}`;
    const masterBankId = `SYNTHETIC-FLOW-${runId}`;

    afterAll(async () => {
      const { prisma } = await import("../../lib/db/prisma");
      await prisma.memorizationQuestion.deleteMany({
        where: { userId }
      });
      await prisma.stqhnQuestion.deleteMany({ where: { masterBankId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    });

    it("select -> reveal -> wrong -> appears in Evaluation Bank -> re-practice -> clean pass -> still retestable", async () => {
      const { prisma } = await import("../../lib/db/prisma");
      const { importStqhnQuestions } =
        await import("../../lib/quran/stqhn/import");
      const { submitAssessment } =
        await import("../../lib/memorization/service");
      const { revealAllRemainingAyahs } =
        await import("../../lib/memorization/reveal/service");
      const { getOrCreateStqhnAttempt, getStqhnHistory } =
        await import("../../lib/memorization/stqhn/service");
      const {
        getEvaluationBank,
        getEvaluationHistory,
        getOrCreateEvaluationSession,
        revealAllRemainingEvaluationAyahs,
        submitEvaluationAttempt
      } = await import("../../lib/memorization/evaluation/service");

      // --- Fixture setup: one real user, one real STQHN bank question ---
      await prisma.user.create({
        data: {
          id: userId,
          email: `${userId}@example.test`,
          passwordHash: "x",
          name: "STQHN Flow Test User"
        }
      });
      const anchor = await prisma.quranVerse.findFirstOrThrow({
        select: { verseKey: true }
      });
      await importStqhnQuestions([
        {
          video_id: `synthetic-flow-${runId}`,
          competition_day: 1,
          competition_branch: "HIFZH_30_JUZ_INDEPENDENT",
          question_type: "HIFZH_PROMPT",
          participant_display_no: 1,
          question_no_for_participant: 1,
          question_id: `SYN-FLOW-${runId}`,
          timestamp_start: "00:00:00",
          timestamp_start_sec: 12,
          start_verse_key: anchor.verseKey,
          end_verse_key: anchor.verseKey,
          passage_range: anchor.verseKey,
          start_word_index: 0,
          starts_at_verse_beginning: true,
          confidence: "HIGH",
          archive_eligible: true,
          audio_review_needed: "NO",
          audit_note: "synthetic test fixture",
          master_bank_id: masterBankId,
          source_youtube_url: "https://www.youtube.com/watch?v=synthetic-flow"
        }
      ]);
      const stqhnQuestion = await prisma.stqhnQuestion.findUniqueOrThrow({
        where: { masterBankId },
        select: { id: true }
      });

      // --- Select (get-or-create) ---
      const selected = await getOrCreateStqhnAttempt(userId, stqhnQuestion.id);
      expect(selected.assessment).toBeNull();
      expect(selected.reveal.revealedAyahCount).toBe(0);

      // Selecting again resumes the SAME underlying question - idempotent,
      // no duplicate MemorizationQuestion row (enforced by
      // @@unique([userId, stqhnQuestionId]), exercised here rather than
      // just trusted).
      const selectedAgain = await getOrCreateStqhnAttempt(
        userId,
        stqhnQuestion.id
      );
      expect(selectedAgain.questionId).toBe(selected.questionId);
      const questionCount = await prisma.memorizationQuestion.count({
        where: { userId, stqhnQuestionId: stqhnQuestion.id }
      });
      expect(questionCount).toBe(1);

      // --- Reveal fully, then grade wrong (bel=1) via the SAME
      // submitAssessment the main cycle uses - no STQHN-specific grading
      // path exists. ---
      await revealAllRemainingAyahs(userId, selected.questionId);
      const wrongResult = await submitAssessment(
        userId,
        selected.questionId,
        1,
        0
      );
      expect(wrongResult.assessment).toBe("MISSED");

      // --- STQHN history's assessedAt must be the grading timestamp
      // (QuestionAssessment.createdAt), never the question-selection
      // timestamp (MemorizationQuestion.createdAt) - these are two
      // different DB rows created at two different moments, and a prior
      // regression sourced assessedAt from the wrong one. ---
      const stqhnHistoryAfterWrong = await getStqhnHistory(userId, null, 50);
      const stqhnHistoryItem = stqhnHistoryAfterWrong.items.find(
        (item) => item.questionId === selected.questionId
      );
      expect(stqhnHistoryItem).toBeDefined();
      const rawAssessment = await prisma.questionAssessment.findUniqueOrThrow({
        where: { questionId: selected.questionId },
        select: { createdAt: true }
      });
      expect(stqhnHistoryItem?.assessedAt).toBe(
        rawAssessment.createdAt.toISOString()
      );

      // --- Appears in the Evaluation Bank via the exact same
      // getEvaluationBank query every other MISSED question uses - no
      // STQHN-aware branch in that function at all. ---
      const bankAfterWrong = await getEvaluationBank(userId, null, 50);
      const bankItem = bankAfterWrong.items.find(
        (item) => item.questionId === selected.questionId
      );
      expect(bankItem).toBeDefined();
      expect(bankItem?.lastResult).toBe("MISSED");

      // --- Re-practice via the existing EvaluationSession/EvaluationAttempt
      // loop, reveal everything, submit a clean 0/0. ---
      await getOrCreateEvaluationSession(userId, selected.questionId);
      await revealAllRemainingEvaluationAyahs(userId, selected.questionId);
      const passAttempt = await submitEvaluationAttempt(
        userId,
        selected.questionId,
        0,
        0,
        `${runId}-pass`
      );
      expect(passAttempt.result).toBe("CORRECT");

      // --- The original main-cycle assessment is untouched (still MISSED)
      // - passing in evaluation practice never overwrites it, so the
      // question remains retestable indefinitely, exactly like the main
      // flow's own MISSED questions. ---
      const mainAssessment = await prisma.questionAssessment.findUniqueOrThrow({
        where: { questionId: selected.questionId },
        select: { assessment: true, belCount: true, tuntunCount: true }
      });
      expect(mainAssessment.assessment).toBe("MISSED");
      expect(mainAssessment.belCount).toBe(1);

      const bankAfterPass = await getEvaluationBank(userId, null, 50);
      expect(
        bankAfterPass.items.some(
          (item) => item.questionId === selected.questionId
        )
      ).toBe(true);

      // --- Both the wrong attempt and the passing attempt are kept as
      // separate history rows - "simpan seluruh attempt/history-nya". ---
      const history = await getEvaluationHistory(userId, null, 50);
      const attemptsForQuestion = history.items.filter(
        (item) => item.questionId === selected.questionId
      );
      expect(attemptsForQuestion).toHaveLength(1);
      expect(attemptsForQuestion[0].result).toBe("CORRECT");

      // A second, wrong practice attempt can still be submitted afterward -
      // "terus dapat diuji ulang", not capped at one re-attempt.
      await getOrCreateEvaluationSession(userId, selected.questionId);
      await revealAllRemainingEvaluationAyahs(userId, selected.questionId);
      const secondAttempt = await submitEvaluationAttempt(
        userId,
        selected.questionId,
        2,
        0,
        `${runId}-retry-2`
      );
      expect(secondAttempt.result).toBe("MISSED");
      const historyAfterSecond = await getEvaluationHistory(userId, null, 50);
      expect(
        historyAfterSecond.items.filter(
          (item) => item.questionId === selected.questionId
        )
      ).toHaveLength(2);
    });
  }
);
