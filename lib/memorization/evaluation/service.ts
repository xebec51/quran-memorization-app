import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { paginateByCursor } from "@/lib/db/cursor-pagination";
import { measureServerTiming } from "@/lib/performance/timing";
import { notFoundError } from "../errors";
import type {
  EvaluationAttemptDto,
  EvaluationBankItem,
  EvaluationHistorySummary,
  RecallAssessment
} from "../types";

const RESULT_PRIORITY: Record<RecallAssessment, number> = {
  MISSED: 0,
  PARTIAL: 1,
  CORRECT: 2
};

const bankQuestionSelect = {
  id: true,
  visibleFragmentText: true,
  assessment: { select: { assessment: true } },
  evaluationAttempts: {
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { createdAt: true }
  }
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
 */
export async function getEvaluationBank(
  userId: string
): Promise<EvaluationBankItem[]> {
  return measureServerTiming("evaluation_bank", async () => {
    const questions = await prisma.memorizationQuestion.findMany({
      where: {
        userId,
        assessment: { assessment: { in: ["MISSED", "PARTIAL"] } }
      },
      select: bankQuestionSelect
    });

    return questions
      .map((question) => ({
        questionId: question.id,
        fragmentText: question.visibleFragmentText,
        lastResult: question.assessment!.assessment,
        lastAttemptAt:
          question.evaluationAttempts[0]?.createdAt.toISOString() ?? null
      }))
      .sort(
        (a, b) => RESULT_PRIORITY[a.lastResult] - RESULT_PRIORITY[b.lastResult]
      );
  });
}

const evaluationAttemptDtoSelect = {
  id: true,
  questionId: true,
  result: true,
  belCount: true,
  tuntunCount: true,
  createdAt: true
} satisfies Prisma.EvaluationAttemptSelect;

/**
 * clientRequestId is a per-submission key the client generates once and
 * resends unchanged on any retry of the same submission (double-click,
 * dropped response, etc). A duplicate is recognized via the unique
 * constraint on the column and returns the attempt already created
 * instead of creating a second row or erroring - see prisma/schema.prisma.
 */
export async function submitEvaluationAttempt(
  userId: string,
  questionId: string,
  result: RecallAssessment,
  belCount: number,
  tuntunCount: number,
  clientRequestId: string
): Promise<EvaluationAttemptDto> {
  return measureServerTiming("evaluation_attempt_submit", async () => {
    const question = await prisma.memorizationQuestion.findFirst({
      where: { id: questionId, userId },
      select: { id: true }
    });
    if (!question) throw notFoundError();

    try {
      const attempt = await prisma.evaluationAttempt.create({
        data: { userId, questionId, result, belCount, tuntunCount, clientRequestId },
        select: evaluationAttemptDtoSelect
      });
      return { ...attempt, createdAt: attempt.createdAt.toISOString() };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const existing = await prisma.evaluationAttempt.findUnique({
          where: { clientRequestId },
          select: evaluationAttemptDtoSelect
        });
        if (existing) {
          return { ...existing, createdAt: existing.createdAt.toISOString() };
        }
      }
      throw error;
    }
  });
}

export async function getEvaluationHistory(
  userId: string,
  cursor: string | null,
  limit: number
) {
  return measureServerTiming("evaluation_history", () =>
    paginateByCursor(
      (args) =>
        prisma.evaluationAttempt.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          select: evaluationAttemptDtoSelect,
          ...args
        }),
      cursor,
      limit,
      (attempt): EvaluationAttemptDto => ({
        ...attempt,
        createdAt: attempt.createdAt.toISOString()
      }),
      (attempt) => attempt.id
    )
  );
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
