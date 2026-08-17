import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
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
  primaryPageNumber: true,
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
 */
export async function getEvaluationBank(userId: string): Promise<EvaluationBankItem[]> {
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
        primaryPageNumber: question.primaryPageNumber,
        lastAttemptAt: question.evaluationAttempts[0]?.createdAt.toISOString() ?? null
      }))
      .sort((a, b) => RESULT_PRIORITY[a.lastResult] - RESULT_PRIORITY[b.lastResult]);
  });
}

export async function submitEvaluationAttempt(
  userId: string,
  questionId: string,
  result: RecallAssessment,
  belCount: number,
  tuntunCount: number
): Promise<EvaluationAttemptDto> {
  return measureServerTiming("evaluation_attempt_submit", async () => {
    const question = await prisma.memorizationQuestion.findFirst({
      where: { id: questionId, userId },
      select: { id: true }
    });
    if (!question) throw notFoundError();

    const attempt = await prisma.evaluationAttempt.create({
      data: { userId, questionId, result, belCount, tuntunCount },
      select: {
        id: true,
        questionId: true,
        result: true,
        belCount: true,
        tuntunCount: true,
        createdAt: true
      }
    });
    return { ...attempt, createdAt: attempt.createdAt.toISOString() };
  });
}

export async function getEvaluationHistory(userId: string, cursor: string | null, limit: number) {
  return measureServerTiming("evaluation_history", async () => {
    const attempts = await prisma.evaluationAttempt.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        questionId: true,
        result: true,
        belCount: true,
        tuntunCount: true,
        createdAt: true
      }
    });
    const hasMore = attempts.length > limit;
    const page = hasMore ? attempts.slice(0, limit) : attempts;
    const items: EvaluationAttemptDto[] = page.map((attempt) => ({
      ...attempt,
      createdAt: attempt.createdAt.toISOString()
    }));
    return { items, nextCursor: hasMore ? page[page.length - 1].id : null };
  });
}

export async function getEvaluationSummary(userId: string): Promise<EvaluationHistorySummary> {
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
    for (const group of resultGroups) resultCounts[group.result] = group._count.result;
    return {
      totalAttempts: totals._count._all,
      totalBelCount: totals._sum.belCount ?? 0,
      totalTuntunCount: totals._sum.tuntunCount ?? 0,
      resultCounts
    };
  });
}
