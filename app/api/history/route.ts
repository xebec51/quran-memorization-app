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
      include: {
        cycle: true,
        questions: { include: { assessment: true, hintEvents: true }, orderBy: { orderInPackage: "asc" } }
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
          hints: question.hintEvents.length,
          assessment: question.assessment?.assessment ?? null
        }))
      }))
    );
  } catch (error) {
    return routeError(error);
  }
}
