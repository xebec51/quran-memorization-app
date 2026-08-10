import "server-only";
import { prisma } from "@/lib/db/prisma";

export async function getAnalytics(userId: string) {
  const [progress, assessments, hints, questions, recentPackages] = await Promise.all([
    prisma.memorizationCycle.findFirst({
      where: { userId },
      orderBy: { cycleNumber: "desc" },
      include: { questions: true, packages: true }
    }),
    prisma.questionAssessment.groupBy({
      by: ["assessment"],
      where: { userId },
      _count: { assessment: true }
    }),
    prisma.hintEvent.groupBy({
      by: ["type"],
      where: { userId },
      _count: { type: true }
    }),
    prisma.memorizationQuestion.findMany({
      where: { userId },
      include: { hintEvents: true, assessment: true },
      orderBy: { createdAt: "desc" }
    }),
    prisma.memorizationPackage.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { questions: { include: { assessment: true, hintEvents: true } } }
    })
  ]);

  const bandPerformance = ["A", "B", "C"].map((band) => {
    const bandQuestions = questions.filter((question) => question.juzBand === band);
    const hintCount = bandQuestions.reduce((sum, question) => sum + question.hintEvents.length, 0);
    const correct = bandQuestions.filter((question) => question.assessment?.assessment === "CORRECT").length;
    return {
      band,
      attempts: bandQuestions.length,
      hints: hintCount,
      correct
    };
  });

  const pageStats = new Map<number, { attempts: number; hints: number; misses: number }>();
  for (const question of questions) {
    const stat = pageStats.get(question.primaryPageNumber) ?? { attempts: 0, hints: 0, misses: 0 };
    stat.attempts += 1;
    stat.hints += question.hintEvents.length;
    if (question.assessment?.assessment === "MISSED") stat.misses += 1;
    pageStats.set(question.primaryPageNumber, stat);
  }

  const weakestPages = [...pageStats.entries()]
    .filter(([, stat]) => stat.attempts >= 2)
    .sort((a, b) => b[1].misses + b[1].hints - (a[1].misses + a[1].hints))
    .slice(0, 8)
    .map(([page, stat]) => ({ page, ...stat }));

  return {
    cycleNumber: progress?.cycleNumber ?? 1,
    pagesTested: progress?.questions.length ?? 0,
    packagesCompleted: progress?.packages.filter((pkg) => pkg.state === "COMPLETED").length ?? 0,
    totalQuestions: questions.length,
    assessmentDistribution: assessments.map((item) => ({
      assessment: item.assessment,
      count: item._count.assessment
    })),
    hintUsage: hints.map((item) => ({ type: item.type, count: item._count.type })),
    bandPerformance,
    weakestPages,
    recentPackages: recentPackages.map((pkg) => ({
      id: pkg.id,
      packageNumber: pkg.packageNumber,
      state: pkg.state,
      createdAt: pkg.createdAt,
      questions: pkg.questions.length,
      assessed: pkg.questions.filter((question) => question.assessment).length,
      hints: pkg.questions.reduce((sum, question) => sum + question.hintEvents.length, 0)
    }))
  };
}
