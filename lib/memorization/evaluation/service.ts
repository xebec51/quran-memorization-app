import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { paginateByCursor } from "@/lib/db/cursor-pagination";
import { measureServerTiming } from "@/lib/performance/timing";
import {
  evaluationAttemptConflictError,
  evaluationNotEligibleError,
  notFoundError,
  revealIncompleteError
} from "../errors";
import { retrySerialization } from "../persistence-retry";
import { computeRevealBoundary, nthVerseFromAnchor } from "../reveal/service";
import type {
  EvaluationAttemptDto,
  EvaluationBankItem,
  EvaluationBankPage,
  EvaluationHistoryItem,
  EvaluationHistoryPage,
  EvaluationHistorySummary,
  EvaluationSessionDto,
  RecallAssessment,
  RevealedAyah
} from "../types";

/**
 * The immutable fragment the question started with, reconstructed from
 * fragmentStartWordId + initialWordCount (set once at question generation,
 * never touched by EXTEND_FRAGMENT hints - those only mutate
 * visibleWordCount/visibleFragmentText on MemorizationQuestion, which is
 * why evaluation mode must not read that column: a question the user
 * extended with hints during the main cycle would otherwise show the
 * extended fragment here too, defeating the point of re-testing recall).
 * One query for an entire page of results, not one per row.
 */
async function immutableFragmentTextsByQuestionId(
  tx: Prisma.TransactionClient | typeof prisma,
  questionIds: string[]
): Promise<Map<string, string>> {
  if (questionIds.length === 0) return new Map();
  const rows = await tx.$queryRaw<
    { questionId: string; fragmentText: string }[]
  >(
    Prisma.sql`
      SELECT q.id AS "questionId",
             string_agg(w."textUthmani", ' ' ORDER BY w.position) AS "fragmentText"
      FROM "MemorizationQuestion" q
      JOIN "QuranWord" start_word ON start_word.id = q."fragmentStartWordId"
      JOIN "QuranWord" w ON w."verseId" = start_word."verseId"
        AND w.position >= start_word.position
        AND w.position < start_word.position + q."initialWordCount"
      WHERE q.id = ANY(${questionIds})
      GROUP BY q.id
    `
  );
  return new Map(rows.map((row) => [row.questionId, row.fragmentText]));
}

const bankQuestionSelect = {
  id: true,
  evaluationAttempts: {
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { createdAt: true }
  },
  assessment: { select: { assessment: true } }
} satisfies Prisma.MemorizationQuestionSelect;

/**
 * Evaluation-eligible = the question's current (latest, main-cycle)
 * assessment is MISSED or PARTIAL. Practicing it here never writes to
 * QuestionAssessment, so the bank membership only changes when the user
 * re-does the *main* question (not an evaluation attempt).
 *
 * Deliberately does not select/return primaryPageNumber (or any other
 * hidden-metadata field - see AGENT.md "Hidden Metadata Rule"): this is
 * the pre-attempt bank listing, so the client must not learn the page
 * before the user has recalled the fragment from memory.
 *
 * Paginated (MISSED before PARTIAL, then question id) rather than loading
 * every eligible question at once - a heavy user's bank can grow large
 * over time.
 */
export async function getEvaluationBank(
  userId: string,
  cursor: string | null,
  limit: number
): Promise<EvaluationBankPage> {
  return measureServerTiming("evaluation_bank", async () => {
    const page = await paginateByCursor(
      (args) =>
        prisma.memorizationQuestion.findMany({
          where: {
            userId,
            assessment: { assessment: { in: ["MISSED", "PARTIAL"] } }
          },
          // RecallAssessment's declaration order is CORRECT, PARTIAL,
          // MISSED, so DESC yields MISSED first, then PARTIAL - id is a
          // tiebreaker so the full ordering (and therefore cursor
          // pagination across it) is deterministic even when many
          // questions share the same result.
          orderBy: [{ assessment: { assessment: "desc" } }, { id: "asc" }],
          select: bankQuestionSelect,
          ...args
        }),
      cursor,
      limit,
      (question) => question,
      (question) => question.id
    );

    const fragments = await immutableFragmentTextsByQuestionId(
      prisma,
      page.items.map((question) => question.id)
    );

    const items: EvaluationBankItem[] = page.items.map((question) => ({
      questionId: question.id,
      fragmentText: fragments.get(question.id) ?? "",
      lastResult: question.assessment!.assessment,
      lastAttemptAt:
        question.evaluationAttempts[0]?.createdAt.toISOString() ?? null
    }));

    return { items, nextCursor: page.nextCursor };
  });
}

/**
 * Fetches the current (possibly just-created) evaluation reveal session
 * for (userId, questionId) - separate from MemorizationQuestion's own
 * reveal columns, which belong to the main-cycle attempt and must never
 * be touched by evaluation practice. Rejects questions that are not
 * MISSED/PARTIAL server-side (never trust that the client only shows
 * eligible questions).
 */
export async function getOrCreateEvaluationSession(
  userId: string,
  questionId: string
): Promise<EvaluationSessionDto> {
  return measureServerTiming("evaluation_session_get_or_create", () =>
    retrySerialization(() =>
      prisma.$transaction(
        async (tx) => {
          const question = await tx.memorizationQuestion.findFirst({
            where: { id: questionId, userId },
            select: {
              id: true,
              anchorVerseId: true,
              primaryPageNumber: true,
              assessment: { select: { assessment: true } }
            }
          });
          if (!question) throw notFoundError();
          if (
            !question.assessment ||
            question.assessment.assessment === "CORRECT"
          ) {
            throw evaluationNotEligibleError();
          }

          const fragments = await immutableFragmentTextsByQuestionId(tx, [
            question.id
          ]);
          const fragmentText = fragments.get(question.id) ?? "";

          const existing = await tx.evaluationSession.findUnique({
            where: { userId_questionId: { userId, questionId } },
            select: {
              revealedAyahCount: true,
              revealTotalAyahCount: true,
              revealedVersesJson: true
            }
          });
          if (existing) {
            return sessionDto(questionId, fragmentText, existing);
          }

          const boundary = await computeRevealBoundary(
            tx,
            question.anchorVerseId,
            question.primaryPageNumber
          );
          const created = await tx.evaluationSession.create({
            data: {
              userId,
              questionId,
              revealBoundaryVerseId: boundary.boundaryVerseId,
              revealTotalAyahCount: boundary.totalAyahCount,
              revealedAyahCount: 0,
              revealedVersesJson: []
            },
            select: {
              revealedAyahCount: true,
              revealTotalAyahCount: true,
              revealedVersesJson: true
            }
          });
          return sessionDto(questionId, fragmentText, created);
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 15_000
        }
      )
    )
  );
}

function sessionDto(
  questionId: string,
  fragmentText: string,
  session: {
    revealedAyahCount: number;
    revealTotalAyahCount: number;
    revealedVersesJson: unknown;
  }
): EvaluationSessionDto {
  return {
    questionId,
    fragmentText,
    revealedAyahCount: session.revealedAyahCount,
    totalAyahCount: session.revealTotalAyahCount,
    isComplete: session.revealedAyahCount >= session.revealTotalAyahCount,
    verses: session.revealedVersesJson as unknown as RevealedAyah[]
  };
}

/**
 * Advances an evaluation session's reveal by exactly one ayah - same
 * expectedRevealedCount optimistic-concurrency/idempotency pattern as the
 * main flow's revealNextAyah (lib/memorization/reveal/service.ts), just
 * against EvaluationSession instead of MemorizationQuestion.
 */
export async function revealNextEvaluationAyah(
  userId: string,
  questionId: string,
  expectedRevealedCount: number
): Promise<EvaluationSessionDto> {
  return measureServerTiming("evaluation_reveal_next_ayah", () =>
    retrySerialization(() =>
      prisma.$transaction(
        async (tx) => {
          const question = await tx.memorizationQuestion.findFirst({
            where: { id: questionId, userId },
            select: { id: true, anchorVerseId: true }
          });
          if (!question) throw notFoundError();

          const session = await tx.evaluationSession.findUnique({
            where: { userId_questionId: { userId, questionId } },
            select: {
              id: true,
              revealedAyahCount: true,
              revealTotalAyahCount: true,
              revealedVersesJson: true
            }
          });
          if (!session) throw notFoundError();

          let nextCount = session.revealedAyahCount;
          let verses = session.revealedVersesJson as unknown as RevealedAyah[];
          const canAdvance =
            session.revealedAyahCount === expectedRevealedCount &&
            session.revealedAyahCount < session.revealTotalAyahCount;

          if (canAdvance) {
            const newVerse = await nthVerseFromAnchor(
              tx,
              question.anchorVerseId,
              session.revealedAyahCount
            );
            nextCount = session.revealedAyahCount + 1;
            verses = [...verses, newVerse];
            await tx.evaluationSession.update({
              where: { id: session.id },
              data: {
                revealedAyahCount: nextCount,
                revealedVersesJson: verses as unknown as Prisma.InputJsonValue
              },
              select: { id: true }
            });
          }

          const fragments = await immutableFragmentTextsByQuestionId(tx, [
            questionId
          ]);
          return sessionDto(questionId, fragments.get(questionId) ?? "", {
            revealedAyahCount: nextCount,
            revealTotalAyahCount: session.revealTotalAyahCount,
            revealedVersesJson: verses
          });
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 15_000
        }
      )
    )
  );
}

const evaluationAttemptDtoSelect = {
  id: true,
  questionId: true,
  result: true,
  belCount: true,
  tuntunCount: true,
  createdAt: true
} satisfies Prisma.EvaluationAttemptSelect;

function payloadMatches(
  existing: {
    questionId: string;
    result: RecallAssessment;
    belCount: number;
    tuntunCount: number;
  },
  questionId: string,
  result: RecallAssessment,
  belCount: number,
  tuntunCount: number
) {
  return (
    existing.questionId === questionId &&
    existing.result === result &&
    existing.belCount === belCount &&
    existing.tuntunCount === tuntunCount
  );
}

/**
 * clientRequestId is a per-submission key the client generates once and
 * resends unchanged on any retry of the same submission (double-click,
 * dropped response, etc), scoped to (userId, clientRequestId) - see
 * prisma/schema.prisma. A retry with the SAME payload replays the
 * original result idempotently; a retry with a DIFFERENT payload under
 * the same key is a conflict (409), not silently accepted, since that
 * would mean the caller's own record of what it submitted disagrees with
 * what actually got saved.
 *
 * Requires the question's latest main-cycle assessment to be MISSED or
 * PARTIAL (never CORRECT - checked here independently of the bank
 * listing, which a client could bypass) and its EvaluationSession to be
 * fully revealed before accepting a grade, mirroring the main flow's
 * submitAssessment gate. The session is deleted on success so the next
 * practice of the same question starts fully hidden again.
 */
export async function submitEvaluationAttempt(
  userId: string,
  questionId: string,
  result: RecallAssessment,
  belCount: number,
  tuntunCount: number,
  clientRequestId: string
): Promise<EvaluationAttemptDto> {
  return measureServerTiming("evaluation_attempt_submit", () =>
    retrySerialization(() =>
      prisma.$transaction(
        async (tx) => {
          const existingByKey = await tx.evaluationAttempt.findUnique({
            where: { userId_clientRequestId: { userId, clientRequestId } },
            select: evaluationAttemptDtoSelect
          });
          if (existingByKey) {
            if (
              payloadMatches(
                existingByKey,
                questionId,
                result,
                belCount,
                tuntunCount
              )
            ) {
              return dto(existingByKey);
            }
            throw evaluationAttemptConflictError();
          }

          const question = await tx.memorizationQuestion.findFirst({
            where: { id: questionId, userId },
            select: { id: true, assessment: { select: { assessment: true } } }
          });
          if (!question) throw notFoundError();
          if (
            !question.assessment ||
            question.assessment.assessment === "CORRECT"
          ) {
            throw evaluationNotEligibleError();
          }

          const session = await tx.evaluationSession.findUnique({
            where: { userId_questionId: { userId, questionId } },
            select: {
              id: true,
              revealedAyahCount: true,
              revealTotalAyahCount: true
            }
          });
          if (
            !session ||
            session.revealedAyahCount < session.revealTotalAyahCount
          ) {
            throw revealIncompleteError();
          }

          try {
            const attempt = await tx.evaluationAttempt.create({
              data: {
                userId,
                questionId,
                result,
                belCount,
                tuntunCount,
                clientRequestId
              },
              select: evaluationAttemptDtoSelect
            });
            await tx.evaluationSession.delete({ where: { id: session.id } });
            return dto(attempt);
          } catch (error) {
            if (
              error instanceof Prisma.PrismaClientKnownRequestError &&
              error.code === "P2002"
            ) {
              // Lost a race to a concurrent identical-key submission
              // between the check above and this create.
              const raced = await tx.evaluationAttempt.findUnique({
                where: { userId_clientRequestId: { userId, clientRequestId } },
                select: evaluationAttemptDtoSelect
              });
              if (
                raced &&
                payloadMatches(raced, questionId, result, belCount, tuntunCount)
              ) {
                return dto(raced);
              }
              throw evaluationAttemptConflictError();
            }
            throw error;
          }
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 15_000
        }
      )
    )
  );
}

function dto(attempt: {
  id: string;
  questionId: string;
  result: RecallAssessment;
  belCount: number;
  tuntunCount: number;
  createdAt: Date;
}): EvaluationAttemptDto {
  return { ...attempt, createdAt: attempt.createdAt.toISOString() };
}

export async function getEvaluationHistory(
  userId: string,
  cursor: string | null,
  limit: number
): Promise<EvaluationHistoryPage> {
  return measureServerTiming("evaluation_history", async () => {
    const page = await paginateByCursor(
      (args) =>
        prisma.evaluationAttempt.findMany({
          where: { userId },
          // id as a tiebreaker after createdAt so pagination stays
          // deterministic (no skipped/duplicated rows) even when
          // multiple attempts share the same timestamp.
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: evaluationAttemptDtoSelect,
          ...args
        }),
      cursor,
      limit,
      (attempt) => attempt,
      (attempt) => attempt.id
    );

    const fragments = await immutableFragmentTextsByQuestionId(
      prisma,
      page.items.map((attempt) => attempt.questionId)
    );

    const items: EvaluationHistoryItem[] = page.items.map((attempt) => ({
      ...dto(attempt),
      fragmentText: fragments.get(attempt.questionId) ?? ""
    }));

    return { items, nextCursor: page.nextCursor };
  });
}

export async function getEvaluationSummary(
  userId: string
): Promise<EvaluationHistorySummary> {
  return measureServerTiming("evaluation_summary", async () => {
    const [totals, resultGroups] = await Promise.all([
      prisma.evaluationAttempt.aggregate({
        where: { userId },
        _count: { _all: true },
        _sum: { belCount: true, tuntunCount: true }
      }),
      prisma.evaluationAttempt.groupBy({
        by: ["result"],
        where: { userId },
        _count: { result: true }
      })
    ]);
    const resultCounts: Record<RecallAssessment, number> = {
      CORRECT: 0,
      PARTIAL: 0,
      MISSED: 0
    };
    for (const group of resultGroups)
      resultCounts[group.result] = group._count.result;
    return {
      totalAttempts: totals._count._all,
      totalBelCount: totals._sum.belCount ?? 0,
      totalTuntunCount: totals._sum.tuntunCount ?? 0,
      resultCounts
    };
  });
}
