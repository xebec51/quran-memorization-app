import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { paginateByCursor } from "@/lib/db/cursor-pagination";
import { measureServerTiming } from "@/lib/performance/timing";
import type { RevealedAyah } from "../types";

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
      visibleFragmentText: true,
      revealedVersesJson: true,
      assessment: {
        select: { assessment: true, belCount: true, tuntunCount: true }
      },
      _count: { select: { hintEvents: true } }
    }
  }
} satisfies Prisma.MemorizationPackageSelect;

export async function getPackageHistory(
  userId: string,
  cursor: string | null,
  limit: number
) {
  return measureServerTiming("package_history", () =>
    paginateByCursor(
      (args) =>
        prisma.memorizationPackage.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          select: packageHistorySelect,
          ...args
        }),
      cursor,
      limit,
      (pkg) => ({
        id: pkg.id,
        cycleNumber: pkg.cycle.cycleNumber,
        packageNumber: pkg.packageNumber,
        state: pkg.state,
        createdAt: pkg.createdAt,
        completedAt: pkg.completedAt,
        questions: pkg.questions.map((question) => {
          // Reached only via MemorizationPackage.questions, so
          // orderInPackage is always set alongside packageId at creation
          // (allocatePackage) - this mirrors the same defensive check in
          // lib/memorization/service.ts's publicQuestionFromRecord for a
          // structurally identical package-scoped read, now that the
          // column is nullable schema-wide for STQHN's sake.
          if (question.orderInPackage === null) {
            throw new Error(
              `Package-scoped question ${question.id} has a null orderInPackage.`
            );
          }
          return {
            id: question.id,
            order: question.orderInPackage,
            answerRevealed: Boolean(question.answerRevealedAt),
            hints: question._count.hintEvents,
            assessment: question.assessment?.assessment ?? null,
            belCount: question.assessment?.belCount ?? null,
            tuntunCount: question.assessment?.tuntunCount ?? null,
            // Only meaningful to show once the question has actually been
            // assessed - an in-progress/unassessed question's answer is
            // still hidden metadata (see AGENT.md "Hidden Metadata Rule"),
            // even in the user's own history.
            fragmentText: question.assessment
              ? question.visibleFragmentText
              : null,
            revealedVerses: question.assessment
              ? (question.revealedVersesJson as unknown as RevealedAyah[])
              : null
          };
        })
      }),
      (pkg) => pkg.id
    )
  );
}
