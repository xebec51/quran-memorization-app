import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { measureServerTiming } from "@/lib/performance/timing";

const packageHistorySelect = {
  id: true,
  packageNumber: true,
  state: true,
  createdAt: true,
  completedAt: true,
  cycle: { select: { cycleNumber: true } },
  questions: {
    orderBy: { orderInPackage: "asc" },
    select: {
      id: true,
      orderInPackage: true,
      answerRevealedAt: true,
      assessment: { select: { assessment: true } },
      _count: { select: { hintEvents: true } }
    }
  }
} satisfies Prisma.MemorizationPackageSelect;

export async function getPackageHistory(userId: string, cursor: string | null, limit: number) {
  return measureServerTiming("package_history", async () => {
    const packages = await prisma.memorizationPackage.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: packageHistorySelect
    });
    const hasMore = packages.length > limit;
    const page = hasMore ? packages.slice(0, limit) : packages;
    return {
      items: page.map((pkg) => ({
        id: pkg.id,
        cycleNumber: pkg.cycle.cycleNumber,
        packageNumber: pkg.packageNumber,
        state: pkg.state,
        createdAt: pkg.createdAt,
        completedAt: pkg.completedAt,
        questions: pkg.questions.map((question) => ({
          id: question.id,
          order: question.orderInPackage,
          answerRevealed: Boolean(question.answerRevealedAt),
          hints: question._count.hintEvents,
          assessment: question.assessment?.assessment ?? null
        }))
      })),
      nextCursor: hasMore ? page[page.length - 1].id : null
    };
  });
}
