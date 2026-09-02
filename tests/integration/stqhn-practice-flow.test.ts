import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Proves the STQHN 2025 package allocation reuses existing memorization/
 * evaluation machinery end to end, with zero new evaluation logic:
 * allocating a package creates real MemorizationQuestion rows for all of
 * its questions up front (lib/memorization/stqhn/service.ts's
 * getOrAllocateStqhnPackage), grading one wrong uses the same
 * submitAssessment as the main cycle, a MISSED result surfaces in the
 * exact same Evaluation Bank query with no STQHN-specific carve-out, and
 * re-practicing it to a clean 0/0 uses the exact same
 * EvaluationSession/EvaluationAttempt loop - never overwriting the
 * original main-cycle assessment, so the question stays retestable
 * indefinitely, exactly like a main-cycle MISSED question already does.
 *
 * Package identity is deliberately NOT asserted against a specific
 * synthetic package: getOrAllocateStqhnPackage picks at random from every
 * StqhnPackage that exists (the real 372-question bank may or may not
 * already be imported in this run), so this test only asserts *relative*
 * properties (same vs. different package across calls) that hold
 * regardless of which package was actually picked. Two tiny synthetic
 * packages are imported only to guarantee at least two packages exist
 * even against a bare database, so "the next allocation differs from the
 * one just completed" is provable in every environment.
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
  "STQHN 2025 package allocation reuses existing memorization/evaluation machinery",
  () => {
    const runId = randomUUID().slice(0, 8);
    const userId = `test-stqhn-user-${runId}`;
    const videoId = `synthetic-flow-${runId}`;

    afterAll(async () => {
      const { prisma } = await import("../../lib/db/prisma");
      await prisma.memorizationQuestion.deleteMany({ where: { userId } });
      await prisma.stqhnQuestion.deleteMany({ where: { videoId } });
      await prisma.stqhnPackage.deleteMany({ where: { videoId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    });

    it("allocate -> resume same package -> complete -> next allocation differs -> wrong question -> Evaluation Bank -> re-practice -> clean pass -> still retestable", async () => {
      const { prisma } = await import("../../lib/db/prisma");
      const { importStqhnQuestions } =
        await import("../../lib/quran/stqhn/import");
      const { submitAssessment } =
        await import("../../lib/memorization/service");
      const { revealAllRemainingAyahs } =
        await import("../../lib/memorization/reveal/service");
      const { getOrAllocateStqhnPackage, getStqhnHistory } =
        await import("../../lib/memorization/stqhn/service");
      const {
        getEvaluationBank,
        getEvaluationHistory,
        getOrCreateEvaluationSession,
        revealAllRemainingEvaluationAyahs,
        submitEvaluationAttempt
      } = await import("../../lib/memorization/evaluation/service");

      // --- Fixture setup: one real user, two tiny synthetic 1-question
      // packages sharing a video but distinct participant numbers (so
      // they are two different packages, not one of size 2). ---
      await prisma.user.create({
        data: {
          id: userId,
          email: `${userId}@example.test`,
          passwordHash: "x",
          name: "STQHN Package Flow Test User"
        }
      });
      const verses = await prisma.quranVerse.findMany({
        take: 2,
        select: { verseKey: true }
      });
      const base = {
        video_id: videoId,
        competition_day: 1,
        competition_branch: "HIFZH_30_JUZ_INDEPENDENT" as const,
        question_type: "HIFZH_PROMPT" as const,
        question_no_for_participant: 1,
        timestamp_start: "00:00:00",
        timestamp_start_sec: 0,
        starts_at_verse_beginning: true,
        confidence: "HIGH",
        archive_eligible: true,
        audio_review_needed: "NO",
        audit_note: "synthetic test fixture",
        source_youtube_url: "https://www.youtube.com/watch?v=synthetic-flow"
      };
      await importStqhnQuestions([
        {
          ...base,
          participant_display_no: 1,
          question_id: `SYN-FLOW-${runId}-A`,
          master_bank_id: `SYNTHETIC-FLOW-${runId}-A`,
          start_verse_key: verses[0].verseKey,
          end_verse_key: verses[0].verseKey,
          passage_range: verses[0].verseKey,
          start_word_index: 0
        },
        {
          ...base,
          participant_display_no: 2,
          question_id: `SYN-FLOW-${runId}-B`,
          master_bank_id: `SYNTHETIC-FLOW-${runId}-B`,
          start_verse_key: verses[1].verseKey,
          end_verse_key: verses[1].verseKey,
          passage_range: verses[1].verseKey,
          start_word_index: 0
        }
      ]);

      // --- Allocate the user's first package, then confirm resuming it
      // (calling allocate again before finishing) returns the exact same
      // package, not a freshly randomized one. ---
      const first = await getOrAllocateStqhnPackage(userId);
      expect(first.state).toBe("IN_PROGRESS");
      expect(first.questions.length).toBeGreaterThan(0);
      expect(first.questions[0]?.audio).toEqual({
        videoId: "synthetic-flow",
        startSeconds: 0,
        endSeconds: 15
      });
      const resumed = await getOrAllocateStqhnPackage(userId);
      expect(resumed.id).toBe(first.id);
      expect(resumed.questions.map((q) => q.id).sort()).toEqual(
        first.questions.map((q) => q.id).sort()
      );

      // --- Work through every question in the package via the SAME
      // reveal/submitAssessment the main cycle uses - no STQHN-specific
      // grading path exists. The first question is graded wrong
      // (bel=1), the rest correct (0/0). ---
      let wrongQuestionId: string | null = null;
      for (const [index, question] of first.questions.entries()) {
        await revealAllRemainingAyahs(userId, question.id);
        const belCount = index === 0 ? 1 : 0;
        const result = await submitAssessment(userId, question.id, belCount, 0);
        if (index === 0) {
          expect(result.assessment).toBe("MISSED");
          wrongQuestionId = question.id;
        } else {
          expect(result.assessment).toBe("CORRECT");
        }
      }
      if (!wrongQuestionId) {
        throw new Error("test setup error: allocated package had no questions");
      }

      // --- STQHN history's assessedAt must be the grading timestamp
      // (QuestionAssessment.createdAt), never the question-creation
      // timestamp (MemorizationQuestion.createdAt, set at allocation
      // time for every question in the package at once). ---
      const stqhnHistoryAfterWrong = await getStqhnHistory(userId, null, 50);
      const historyPackage = stqhnHistoryAfterWrong.items.find((pkg) =>
        pkg.questions.some((item) => item.questionId === wrongQuestionId)
      );
      const stqhnHistoryItem = historyPackage?.questions.find(
        (item) => item.questionId === wrongQuestionId
      );
      expect(stqhnHistoryItem).toBeDefined();
      expect(historyPackage?.questions.length).toBeGreaterThan(0);
      const rawAssessment = await prisma.questionAssessment.findUniqueOrThrow({
        where: { questionId: wrongQuestionId },
        select: { createdAt: true }
      });
      expect(stqhnHistoryItem?.assessedAt).toBe(
        rawAssessment.createdAt.toISOString()
      );

      // --- The just-completed package is never immediately handed out
      // again while other packages remain untried - "jangan biarkan
      // paketnya diberikan berulang kecuali sudah dicoba semua". ---
      const second = await getOrAllocateStqhnPackage(userId);
      expect(second.id).not.toBe(first.id);

      // --- The wrong question appears in the Evaluation Bank via the
      // exact same getEvaluationBank query every other MISSED question
      // uses - no STQHN-aware branch in that function at all. ---
      const bankAfterWrong = await getEvaluationBank(userId, null, 50);
      const bankItem = bankAfterWrong.items.find(
        (item) => item.questionId === wrongQuestionId
      );
      expect(bankItem).toBeDefined();
      expect(bankItem?.lastResult).toBe("MISSED");

      // --- Re-practice via the existing EvaluationSession/EvaluationAttempt
      // loop, reveal everything, submit a clean 0/0. ---
      await getOrCreateEvaluationSession(userId, wrongQuestionId);
      await revealAllRemainingEvaluationAyahs(userId, wrongQuestionId);
      const passAttempt = await submitEvaluationAttempt(
        userId,
        wrongQuestionId,
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
        where: { questionId: wrongQuestionId },
        select: { assessment: true, belCount: true, tuntunCount: true }
      });
      expect(mainAssessment.assessment).toBe("MISSED");
      expect(mainAssessment.belCount).toBe(1);

      // --- Both the wrong attempt and the passing attempt are kept as
      // separate history rows - "simpan seluruh attempt/history-nya". ---
      const history = await getEvaluationHistory(userId, null, 50);
      const attemptsForQuestion = history.items.filter(
        (item) => item.questionId === wrongQuestionId
      );
      expect(attemptsForQuestion).toHaveLength(1);
      expect(attemptsForQuestion[0].result).toBe("CORRECT");

      // A second, wrong practice attempt can still be submitted afterward -
      // "terus dapat diuji ulang", not capped at one re-attempt.
      await getOrCreateEvaluationSession(userId, wrongQuestionId);
      await revealAllRemainingEvaluationAyahs(userId, wrongQuestionId);
      const secondAttempt = await submitEvaluationAttempt(
        userId,
        wrongQuestionId,
        2,
        0,
        `${runId}-retry-2`
      );
      expect(secondAttempt.result).toBe("MISSED");
      const historyAfterSecond = await getEvaluationHistory(userId, null, 50);
      expect(
        historyAfterSecond.items.filter(
          (item) => item.questionId === wrongQuestionId
        )
      ).toHaveLength(2);
    });
  }
);
