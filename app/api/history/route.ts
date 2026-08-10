import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { jsonOk, routeError } from "@/lib/validation/api";

export async function GET() {
  try {
    const user = await requireUser();
    const packages = await prisma.memorizationPackage.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
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
      }
    });
    return jsonOk(
      packages.map((pkg) => ({
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
      }))
    );
  } catch (error) {
    return routeError(error);
  }
}
