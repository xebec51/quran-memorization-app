import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Proves getEvaluationBank (lib/memorization/evaluation/service.ts) stops
 * surfacing a question once the user's most recent evaluation practice
 * attempt on it is CORRECT (bel=0 && tuntun=0) - tracked via
 * MemorizationQuestion.evaluationClearedAt, set by submitEvaluationAttempt
 * independently of the immutable main-cycle QuestionAssessment (which
 * evaluation practice never overwrites - see stqhn-practice-flow.test.ts).
 * A later missed practice attempt on the same question must bring it back
 * into the bank, since "already evaluated and answered without a mistake"
 * describes the *current* state, not a permanent exemption.
 *
 * Requires a real Postgres with the full canonical Quran dataset loaded
 * via TEST_DATABASE_URL or DATABASE_URL; skips cleanly if neither is set.
 * See tests/integration/setup-env.ts for how TEST_DATABASE_URL is safely
 * swapped into lib/db/prisma.ts's module-load-time DATABASE_URL read
 * before this file's own imports resolve.
 */
const connectionString =
  process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

const run = connectionString ? describe : describe.skip;

run("Evaluation Bank membership tracks the latest practice attempt", () => {
  const runId = randomUUID().slice(0, 8);
  const userId = `test-eval-clear-user-${runId}`;
  const videoId = `synthetic-eval-clear-${runId}`;

  afterAll(async () => {
    const { prisma } = await import("../../lib/db/prisma");
    await prisma.memorizationQuestion.deleteMany({ where: { userId } });
    await prisma.stqhnQuestion.deleteMany({ where: { videoId } });
    await prisma.stqhnPackage.deleteMany({ where: { videoId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("removes a question after a clean pass, then re-adds it after a later miss", async () => {
    const { prisma } = await import("../../lib/db/prisma");
    const { importStqhnQuestions } =
      await import("../../lib/quran/stqhn/import");
    const { submitAssessment } = await import("../../lib/memorization/service");
    const { revealAllRemainingAyahs } =
      await import("../../lib/memorization/reveal/service");
    const { getOrAllocateStqhnPackage } =
      await import("../../lib/memorization/stqhn/service");
    const {
      getEvaluationBank,
      getOrCreateEvaluationSession,
      revealAllRemainingEvaluationAyahs,
      submitEvaluationAttempt
    } = await import("../../lib/memorization/evaluation/service");

    await prisma.user.create({
      data: {
        id: userId,
        email: `${userId}@example.test`,
        passwordHash: "x",
        name: "Evaluation Bank Clear Test User"
      }
    });
    const verse = await prisma.quranVerse.findFirstOrThrow({
      select: { verseKey: true }
    });
    await importStqhnQuestions([
      {
        video_id: videoId,
        competition_day: 1,
        competition_branch: "HIFZH_30_JUZ_INDEPENDENT" as const,
        question_type: "HIFZH_PROMPT" as const,
        participant_display_no: 1,
        question_no_for_participant: 1,
        question_id: `SYN-EVALCLEAR-${runId}-A`,
        master_bank_id: `SYNTHETIC-EVALCLEAR-${runId}-A`,
        start_verse_key: verse.verseKey,
        end_verse_key: verse.verseKey,
        passage_range: verse.verseKey,
        start_word_index: 0,
        timestamp_start: "00:00:00",
        timestamp_start_sec: 0,
        starts_at_verse_beginning: true,
        confidence: "HIGH",
        archive_eligible: true,
        audio_review_needed: "NO",
        audit_note: "synthetic test fixture",
        source_youtube_url:
          "https://www.youtube.com/watch?v=synthetic-eval-clear"
      }
    ]);

    const pkg = await getOrAllocateStqhnPackage(userId);
    const questionId = pkg.questions[0].id;

    await revealAllRemainingAyahs(userId, questionId);
    const graded = await submitAssessment(userId, questionId, 1, 0);
    expect(graded.assessment).toBe("MISSED");

    const bankBefore = await getEvaluationBank(userId, null, 50);
    expect(
      bankBefore.items.some((item) => item.questionId === questionId)
    ).toBe(true);

    // A clean 0/0 practice pass clears the question from the bank.
    await getOrCreateEvaluationSession(userId, questionId);
    await revealAllRemainingEvaluationAyahs(userId, questionId);
    const pass = await submitEvaluationAttempt(
      userId,
      questionId,
      0,
      0,
      `${runId}-pass`
    );
    expect(pass.result).toBe("CORRECT");

    const bankAfterPass = await getEvaluationBank(userId, null, 50);
    expect(
      bankAfterPass.items.some((item) => item.questionId === questionId)
    ).toBe(false);

    // The main-cycle assessment is still MISSED - only bank membership
    // changed, never the original QuestionAssessment.
    const mainAssessment = await prisma.questionAssessment.findUniqueOrThrow({
      where: { questionId },
      select: { assessment: true }
    });
    expect(mainAssessment.assessment).toBe("MISSED");

    // A later missed practice attempt brings it back into the bank.
    await getOrCreateEvaluationSession(userId, questionId);
    await revealAllRemainingEvaluationAyahs(userId, questionId);
    const missedAgain = await submitEvaluationAttempt(
      userId,
      questionId,
      2,
      0,
      `${runId}-missed-again`
    );
    expect(missedAgain.result).toBe("MISSED");

    const bankAfterMiss = await getEvaluationBank(userId, null, 50);
    expect(
      bankAfterMiss.items.some((item) => item.questionId === questionId)
    ).toBe(true);
  });
});
