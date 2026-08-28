import "server-only";
import { prisma } from "@/lib/db/prisma";
import { measureServerTiming } from "@/lib/performance/timing";

type BandPerformanceRow = {
  band: "A" | "B" | "C";
  attempts: number;
  hints: number;
  correct: number;
};

type WeakestPageRow = {
  page: number;
  attempts: number;
  hints: number;
  misses: number;
};

export async function getAnalytics(userId: string) {
  return measureServerTiming("analytics_query", async () => {
    const cycle = await prisma.memorizationCycle.findFirst({
      where: { userId },
      orderBy: { cycleNumber: "desc" },
      select: { id: true, cycleNumber: true }
    });

    const [
      pagesTested,
      packagesCompleted,
      totalQuestions,
      assessments,
      hints,
      bandRows,
      weakestRows,
      recentPackages
    ] = await Promise.all([
      cycle
        ? prisma.memorizationQuestion.count({ where: { cycleId: cycle.id } })
        : Promise.resolve(0),
      cycle
        ? prisma.memorizationPackage.count({
            where: { cycleId: cycle.id, state: "COMPLETED" }
          })
        : Promise.resolve(0),
      // This whole page tells the story of 604-page cycle progress, and a
      // question sourced from an external bank (STQHN 2025 - see
      // stqhnQuestionId on MemorizationQuestion) was never part of that
      // cycle. Mixing it in would silently skew every metric below with
      // attempts/hints that don't belong to the rotation these views
      // describe - STQHN gets its own summary on its own page instead
      // (lib/memorization/stqhn/service.ts) - so every query in this
      // Promise.all that reads MemorizationQuestion, directly or via a
      // relation, is scoped to cycleId IS NOT NULL, same as
      // pagesTested/packagesCompleted above.
      prisma.memorizationQuestion.count({
        where: { userId, cycleId: { not: null } }
      }),
      prisma.questionAssessment.groupBy({
        by: ["assessment"],
        where: { userId, question: { cycleId: { not: null } } },
        _count: { assessment: true }
      }),
      prisma.hintEvent.groupBy({
        by: ["type"],
        where: { userId, question: { cycleId: { not: null } } },
        _count: { type: true }
      }),
      prisma.$queryRaw<BandPerformanceRow[]>`
        SELECT
          question."juzBand"::text AS "band",
          COUNT(DISTINCT question."id")::int AS "attempts",
          COUNT(hint."id")::int AS "hints",
          COUNT(DISTINCT CASE WHEN assessment."assessment" = 'CORRECT' THEN question."id" END)::int AS "correct"
        FROM "MemorizationQuestion" AS question
        LEFT JOIN "QuestionAssessment" AS assessment ON assessment."questionId" = question."id"
        LEFT JOIN "HintEvent" AS hint ON hint."questionId" = question."id"
        WHERE question."userId" = ${userId} AND question."cycleId" IS NOT NULL
        GROUP BY question."juzBand"
      `,
      prisma.$queryRaw<WeakestPageRow[]>`
        SELECT
          question."primaryPageNumber"::int AS "page",
          COUNT(DISTINCT question."id")::int AS "attempts",
          COUNT(hint."id")::int AS "hints",
          COUNT(DISTINCT CASE WHEN assessment."assessment" = 'MISSED' THEN question."id" END)::int AS "misses"
        FROM "MemorizationQuestion" AS question
        LEFT JOIN "QuestionAssessment" AS assessment ON assessment."questionId" = question."id"
        LEFT JOIN "HintEvent" AS hint ON hint."questionId" = question."id"
        WHERE question."userId" = ${userId} AND question."cycleId" IS NOT NULL
        GROUP BY question."primaryPageNumber"
        HAVING COUNT(DISTINCT question."id") >= 2
        ORDER BY (
          COUNT(DISTINCT CASE WHEN assessment."assessment" = 'MISSED' THEN question."id" END) + COUNT(hint."id")
        ) DESC
        LIMIT 8
      `,
      prisma.memorizationPackage.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          packageNumber: true,
          state: true,
          createdAt: true,
          questions: {
            select: {
              assessment: { select: { assessment: true } },
              _count: { select: { hintEvents: true } }
            }
          }
        }
      })
    ]);

    const bandPerformance = (["A", "B", "C"] as const).map((band) => {
      const row = bandRows.find((item) => item.band === band);
      return {
        band,
        attempts: row?.attempts ?? 0,
        hints: row?.hints ?? 0,
        correct: row?.correct ?? 0
      };
    });

    return {
      cycleNumber: cycle?.cycleNumber ?? 1,
      pagesTested,
      packagesCompleted,
      totalQuestions,
      assessmentDistribution: assessments.map((item) => ({
        assessment: item.assessment,
        count: item._count.assessment
      })),
      hintUsage: hints.map((item) => ({
        type: item.type,
        count: item._count.type
      })),
      bandPerformance,
      weakestPages: weakestRows.map((row) => ({
        page: row.page,
        attempts: row.attempts,
        hints: row.hints,
        misses: row.misses
      })),
      recentPackages: recentPackages.map((pkg) => ({
        id: pkg.id,
        packageNumber: pkg.packageNumber,
        state: pkg.state,
        createdAt: pkg.createdAt,
        questions: pkg.questions.length,
        assessed: pkg.questions.filter((question) => question.assessment)
          .length,
        hints: pkg.questions.reduce(
          (sum, question) => sum + question._count.hintEvents,
          0
        )
      }))
    };
  });
}
