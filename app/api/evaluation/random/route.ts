import { Prisma } from "@/generated/prisma/client";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { withServerTiming } from "@/lib/performance/timing";
import type { EvaluationBankItem } from "@/lib/memorization/types";
import { jsonOk, routeError } from "@/lib/validation/api";

const randomQuestionSelect = {
  id: true,
  evaluationAttempts: {
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { createdAt: true }
  },
  assessment: { select: { assessment: true } }
} satisfies Prisma.MemorizationQuestionSelect;

export async function GET(request: Request) {
  return withServerTiming(async () => {
    try {
      const user = await requireUser();
      const { searchParams } = new URL(request.url);
      const excludeQuestionId = searchParams.get("exclude") || undefined;
      const where: Prisma.MemorizationQuestionWhereInput = {
        userId: user.id,
        ...(excludeQuestionId ? { id: { not: excludeQuestionId } } : {}),
        assessment: { assessment: { in: ["MISSED", "PARTIAL"] } },
        evaluationClearedAt: null
      };

      let count = await prisma.memorizationQuestion.count({ where });
      let effectiveWhere: Prisma.MemorizationQuestionWhereInput = where;

      // Prefer a different question from the one currently open. When the
      // bank contains only that one question, fall back to it gracefully.
      if (count === 0 && excludeQuestionId) {
        effectiveWhere = {
          userId: user.id,
          assessment: { assessment: { in: ["MISSED", "PARTIAL"] } },
          evaluationClearedAt: null
        };
        count = await prisma.memorizationQuestion.count({
          where: effectiveWhere
        });
      }

      if (count === 0) return jsonOk<EvaluationBankItem | null>(null);

      const question = await prisma.memorizationQuestion.findFirst({
        where: effectiveWhere,
        orderBy: { id: "asc" },
        skip: Math.floor(Math.random() * count),
        select: randomQuestionSelect
      });
      if (!question?.assessment) return jsonOk<EvaluationBankItem | null>(null);

      const fragments = await prisma.$queryRaw<{ fragmentText: string }[]>(
        Prisma.sql`
          SELECT string_agg(w."textUthmani", ' ' ORDER BY w.position) AS "fragmentText"
          FROM "MemorizationQuestion" q
          JOIN "QuranWord" start_word ON start_word.id = q."fragmentStartWordId"
          JOIN "QuranWord" w ON w."verseId" = start_word."verseId"
            AND w.position >= start_word.position
            AND w.position < start_word.position + q."initialWordCount"
          WHERE q.id = ${question.id}
        `
      );

      return jsonOk<EvaluationBankItem>({
        questionId: question.id,
        fragmentText: fragments[0]?.fragmentText ?? "",
        lastResult: question.assessment.assessment,
        lastAttemptAt:
          question.evaluationAttempts[0]?.createdAt.toISOString() ?? null
      });
    } catch (error) {
      return routeError(error);
    }
  });
}
