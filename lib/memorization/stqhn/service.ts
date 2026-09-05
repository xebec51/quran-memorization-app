import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { measureServerTiming } from "@/lib/performance/timing";
import { bandForJuz } from "../cycle/constants";
import { CryptoRandomSource } from "../random";
import { retrySerialization } from "../persistence-retry";
import { computeRevealBoundariesBulk } from "../reveal/service";
import { chooseStqhnPackageId } from "./allocation";
import type {
  RecallAssessment,
  RevealedAyah,
  StqhnHistoryItem,
  StqhnHistoryPackage,
  StqhnHistoryPage,
  StqhnPackageDto,
  StqhnPackageQuestion,
  StqhnSummary
} from "../types";

export async function getStqhnSummary(userId: string): Promise<StqhnSummary> {
  return measureServerTiming("stqhn_summary", async () => {
    const [totalQuestions, attemptedCount, assessmentCounts] =
      await Promise.all([
        prisma.stqhnQuestion.count(),
        prisma.memorizationQuestion.count({
          where: { userId, stqhnQuestionId: { not: null } }
        }),
        prisma.questionAssessment.groupBy({
          by: ["assessment"],
          where: { userId, question: { stqhnQuestionId: { not: null } } },
          _count: { _all: true }
        })
      ]);
    let correctCount = 0;
    let missedCount = 0;
    for (const row of assessmentCounts) {
      if (row.assessment === "CORRECT") correctCount += row._count._all;
      else missedCount += row._count._all;
    }
    return { totalQuestions, attemptedCount, correctCount, missedCount };
  });
}

const packageQuestionSelect = {
  id: true,
  visibleFragmentText: true,
  revealedAyahCount: true,
  revealTotalAyahCount: true,
  revealedVersesJson: true,
  assessment: { select: { assessment: true } },
  stqhnQuestion: {
    select: {
      questionNoForParticipant: true,
      videoId: true,
      timestampStartSec: true,
      timestampEndSec: true
    }
  }
} satisfies Prisma.MemorizationQuestionSelect;

type PackageQuestionRow = Prisma.MemorizationQuestionGetPayload<{
  select: typeof packageQuestionSelect;
}>;

const packageSelect = {
  id: true,
  competitionDay: true,
  competitionBranch: true,
  participantDisplayNo: true
} satisfies Prisma.StqhnPackageSelect;

type PackageRow = Prisma.StqhnPackageGetPayload<{
  select: typeof packageSelect;
}>;

function packageQuestionDto(
  question: PackageQuestionRow
): StqhnPackageQuestion {
  const stqhnQuestion = question.stqhnQuestion!;
  // The source end timestamp is the end of the participant's complete
  // answer, not the end of the judge's prompt. Never expose that whole
  // interval before assessment: it would reveal the expected continuation.
  // Until prompt-specific end timestamps are curated, use a deliberately
  // short clip and let the learner replay it when necessary.
  const conservativeEnd = stqhnQuestion.timestampStartSec + 15;
  return {
    id: question.id,
    order: question.stqhnQuestion!.questionNoForParticipant,
    fragmentText: question.visibleFragmentText,
    audio: {
      videoId: stqhnQuestion.videoId,
      startSeconds: stqhnQuestion.timestampStartSec,
      endSeconds: Math.min(
        stqhnQuestion.timestampEndSec ?? conservativeEnd,
        conservativeEnd
      )
    },
    reveal: {
      revealedAyahCount: question.revealedAyahCount,
      totalAyahCount: question.revealTotalAyahCount,
      isComplete: question.revealedAyahCount >= question.revealTotalAyahCount,
      verses: question.revealedVersesJson as unknown as RevealedAyah[]
    },
    assessment:
      (question.assessment?.assessment as RecallAssessment | undefined) ?? null
  };
}

function packageDto(
  pkg: PackageRow,
  questionRows: PackageQuestionRow[]
): StqhnPackageDto {
  const questions = questionRows
    .map(packageQuestionDto)
    .sort((a, b) => a.order - b.order);
  const allAssessed = questions.every((item) => item.assessment !== null);
  return {
    id: pkg.id,
    competitionDay: pkg.competitionDay,
    competitionBranch: pkg.competitionBranch,
    participantDisplayNo: pkg.participantDisplayNo,
    state: allAssessed ? "COMPLETED" : "IN_PROGRESS",
    questions,
    activeQuestionId:
      questions.find((item) => item.assessment === null)?.id ??
      questions[0]?.id ??
      null
  };
}

async function fetchPackageDto(
  tx: Prisma.TransactionClient | typeof prisma,
  userId: string,
  stqhnPackageId: string
): Promise<StqhnPackageDto> {
  // Sequential, not Promise.all: an interactive transaction's tx client
  // is bound to a single reserved connection and cannot run concurrent
  // queries - see commit b5669f3, which hit exactly this ("P2028
  // transaction already closed") in allocatePackage/computeRevealBoundary
  // and fixed it the same way. Every caller here can pass either a real
  // tx (inside getOrAllocateStqhnPackage's transaction) or the top-level
  // prisma client (getCurrentStqhnPackage's read-only path), so this
  // stays sequential unconditionally rather than branching on which one
  // was passed.
  const pkg = await tx.stqhnPackage.findUniqueOrThrow({
    where: { id: stqhnPackageId },
    select: packageSelect
  });
  return fetchPackageQuestionsDto(tx, userId, pkg);
}

async function fetchPackageQuestionsDto(
  tx: Prisma.TransactionClient | typeof prisma,
  userId: string,
  pkg: PackageRow
): Promise<StqhnPackageDto> {
  const questionRows = await tx.memorizationQuestion.findMany({
    where: { userId, stqhnQuestion: { stqhnPackageId: pkg.id } },
    select: packageQuestionSelect
  });
  return packageDto(pkg, questionRows);
}

/**
 * The user's current in-progress STQHN package - the most recently
 * assigned one, unless it has since been fully assessed (in which case
 * there is no "current" package: the next selection allocates a new one).
 * At most one in-progress package ever exists per user, because
 * getOrAllocateStqhnPackage always resumes an existing incomplete package
 * instead of allocating a second one on top of it.
 */
async function findActivePackage(
  tx: Prisma.TransactionClient | typeof prisma,
  userId: string
): Promise<StqhnPackageDto | null> {
  const mostRecent = await tx.memorizationQuestion.findFirst({
    where: { userId, stqhnQuestionId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: {
      stqhnQuestion: {
        select: { stqhnPackage: { select: packageSelect } }
      }
    }
  });
  if (!mostRecent?.stqhnQuestion) return null;
  const dto = await fetchPackageQuestionsDto(
    tx,
    userId,
    mostRecent.stqhnQuestion.stqhnPackage
  );
  return dto.state === "COMPLETED" ? null : dto;
}

/**
 * Read-only lookup of the user's current in-progress package, for the SSR
 * initial page load - mirrors getCurrentPackage for the main cycle. Never
 * allocates, so a fresh user (or one whose last package is complete) gets
 * null here and only gets a package via getOrAllocateStqhnPackage.
 */
export async function getCurrentStqhnPackage(
  userId: string
): Promise<StqhnPackageDto | null> {
  return measureServerTiming("stqhn_current_package", () =>
    findActivePackage(prisma, userId)
  );
}

const stqhnSourceForCreateSelect = {
  id: true,
  questionNoForParticipant: true,
  anchorVerseId: true,
  fragmentStartWordId: true,
  initialWordCount: true,
  fragmentText: true,
  anchorVerse: {
    select: {
      pageNumber: true,
      juzNumber: true,
      chapterId: true,
      verseKey: true
    }
  },
  fragmentStartWord: { select: { lineNumber: true } }
} satisfies Prisma.StqhnQuestionSelect;

/**
 * Creates every MemorizationQuestion row for one STQHN package in a
 * single batch (computeRevealBoundariesBulk + createMany), the same
 * up-front-not-lazy shape as the main cycle's allocatePackage - so the
 * package arrives with all 4 questions ready and an activeQuestionId,
 * rather than lazily creating each one as the user reaches it.
 */
async function allocateStqhnPackage(
  tx: Prisma.TransactionClient,
  userId: string,
  stqhnPackageId: string
): Promise<StqhnPackageDto> {
  // Only the package's own questions are needed here - the package DTO
  // itself is built by the fetchPackageDto call below, which re-reads it
  // fresh alongside the just-created MemorizationQuestion rows.
  const sources = await tx.stqhnQuestion.findMany({
    where: { stqhnPackageId },
    orderBy: { questionNoForParticipant: "asc" },
    select: stqhnSourceForCreateSelect
  });

  const boundaries = await computeRevealBoundariesBulk(
    tx,
    sources.map((source) => ({
      anchorVerseId: source.anchorVerseId,
      primaryPageNumber: source.anchorVerse.pageNumber,
      fragmentStartLineNumber: source.fragmentStartWord.lineNumber
    }))
  );

  const questionRows = sources.map((source, index) => ({
    id: randomUUID(),
    userId,
    stqhnQuestionId: source.id,
    state: "ACTIVE" as const,
    primaryPageNumber: source.anchorVerse.pageNumber,
    juzNumber: source.anchorVerse.juzNumber,
    juzBand: bandForJuz(source.anchorVerse.juzNumber),
    surahId: source.anchorVerse.chapterId,
    anchorVerseId: source.anchorVerseId,
    anchorVerseKey: source.anchorVerse.verseKey,
    pagePositionBucket: "START" as const,
    fragmentStartWordId: source.fragmentStartWordId,
    initialWordCount: source.initialWordCount,
    visibleWordCount: source.initialWordCount,
    visibleFragmentText: source.fragmentText,
    revealBoundaryVerseId: boundaries[index].boundaryVerseId,
    revealTotalAyahCount: boundaries[index].totalAyahCount,
    revealedVersesJson: [] as unknown as Prisma.InputJsonValue
  }));

  try {
    await tx.memorizationQuestion.createMany({ data: questionRows });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      // Lost a race to a concurrent allocation of the same package for
      // this user (double-click/double-tap, or two open tabs) -
      // @@unique([userId, stqhnQuestionId]) means the winner already
      // created exactly the rows this call would have, so resume them
      // instead of surfacing a spurious conflict for what the user
      // experiences as a single click. getOrAllocateStqhnPackage never
      // knowingly re-picks an already-completed package (see its own
      // doc comment), so in practice this is the only way this branch
      // is reached - a genuine concurrent pick of the SAME still-fresh
      // package, not a stale/completed one.
      return fetchPackageDto(tx, userId, stqhnPackageId);
    }
    throw error;
  }

  return fetchPackageDto(tx, userId, stqhnPackageId);
}

/**
 * Gets the user's current in-progress STQHN package, or allocates a new
 * one at random - "diacak sesuai paketnya" - never repeating a package
 * the user has already fully completed (every one of its questions
 * assessed, correct or missed) as long as an untried package remains.
 *
 * Once every existing package has been completed at least once, there is
 * no fresh package left to hand out: unlike the main cycle's wildcard
 * deck (which reshuffles because a new cycle always generates brand-new
 * MemorizationQuestion rows), an STQHN question's MemorizationQuestion
 * row is permanent per (userId, stqhnQuestionId) - re-picking an
 * already-completed package could only ever resurface its old, unchanged
 * assessment, never offer a genuine new attempt. Rather than silently
 * serving that stale, already-graded package on a loop, this throws
 * allStqhnPackagesCompletedError so the UI can show an honest "you've
 * finished everything" state and point to Riwayat STQHN instead.
 */
export async function getOrAllocateStqhnPackage(
  userId: string
): Promise<StqhnPackageDto> {
  return measureServerTiming("stqhn_package_allocate", () =>
    retrySerialization(() =>
      prisma.$transaction(
        async (tx) => {
          const active = await findActivePackage(tx, userId);
          if (active) return active;

          // Every package this user has ever been assigned, and whether
          // every one of its questions is assessed for them - the
          // "already tried" pool a fresh pick must avoid. Package size
          // varies (this user's own assigned rows for it), so a package
          // only counts as completed once its assessedCount matches its
          // own total, not a fixed constant.
          const progress = await tx.$queryRaw<
            { packageId: string; total: number; assessedCount: number }[]
          >(Prisma.sql`
            SELECT sq."stqhnPackageId" AS "packageId",
                   COUNT(*)::int AS "total",
                   COUNT(qa.id)::int AS "assessedCount"
            FROM "MemorizationQuestion" mq
            JOIN "StqhnQuestion" sq ON sq.id = mq."stqhnQuestionId"
            LEFT JOIN "QuestionAssessment" qa ON qa."questionId" = mq.id
            WHERE mq."userId" = ${userId}
            GROUP BY sq."stqhnPackageId"
          `);
          const completedIds = new Set(
            progress
              .filter((row) => row.total === row.assessedCount)
              .map((row) => row.packageId)
          );

          const allPackages = await tx.stqhnPackage.findMany({
            select: { id: true }
          });
          const chosenId = chooseStqhnPackageId(
            allPackages.map((item) => item.id),
            completedIds,
            new CryptoRandomSource()
          );
          return allocateStqhnPackage(tx, userId, chosenId);
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 20_000
        }
      )
    )
  );
}

const historySelect = {
  id: true,
  visibleFragmentText: true,
  revealedVersesJson: true,
  stqhnQuestion: {
    select: {
      id: true,
      questionId: true,
      questionNoForParticipant: true,
      competitionBranch: true,
      competitionDay: true,
      stqhnPackage: {
        select: {
          id: true,
          participantDisplayNo: true
        }
      },
      passageRange: true,
      sourceYoutubeUrl: true,
      timestampStartSec: true
    }
  },
  assessment: {
    select: {
      assessment: true,
      belCount: true,
      tuntunCount: true,
      createdAt: true
    }
  }
} satisfies Prisma.MemorizationQuestionSelect;

/**
 * Returns assessed questions grouped and paginated by their original
 * competition package. Grouping on the server is important: client-side
 * grouping of a question-paginated list could split one four-question
 * package across two pages. Each question includes the source video link
 * with a timestamp - safe here
 * specifically because history only ever shows a question the user has
 * already answered (see AGENT.md "Hidden Metadata Rule": the video is
 * the recorded original answer, so it must never reach the client before
 * the question was earned by finishing it, same reasoning as the fragment
 * text and revealed verses already hidden pre-assessment everywhere else
 * in this app).
 */
export async function getStqhnHistory(
  userId: string,
  cursor: string | null,
  limit: number
): Promise<StqhnHistoryPage> {
  return measureServerTiming("stqhn_history", async () => {
    // First fetch only the compact ordered package index. The old query loaded
    // every assessed question (including its revealed-verses JSON and display
    // metadata) before slicing ten packages in memory. This retains the same
    // package cursor contract while keeping the heavy query limited to the
    // packages that are actually rendered on this page.
    const packageIndex = await prisma.$queryRaw<
      { packageId: string; latestAssessedAt: Date }[]
    >(Prisma.sql`
      SELECT sq."stqhnPackageId" AS "packageId",
             MAX(qa."createdAt") AS "latestAssessedAt"
      FROM "QuestionAssessment" qa
      JOIN "MemorizationQuestion" mq ON mq.id = qa."questionId"
      JOIN "StqhnQuestion" sq ON sq.id = mq."stqhnQuestionId"
      WHERE qa."userId" = ${userId}
        AND mq."userId" = ${userId}
      GROUP BY sq."stqhnPackageId"
      ORDER BY MAX(qa."createdAt") DESC, sq."stqhnPackageId" DESC
    `);

    const cursorIndex = cursor
      ? packageIndex.findIndex((pkg) => pkg.packageId === cursor)
      : -1;
    const start = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    const pageIndex = packageIndex.slice(start, start + limit);
    const hasMore = start + limit < packageIndex.length;
    if (pageIndex.length === 0) {
      return { items: [], nextCursor: null };
    }

    const pagePackageIds = pageIndex.map((pkg) => pkg.packageId);
    const rows = await prisma.memorizationQuestion.findMany({
      where: {
        userId,
        stqhnQuestion: { stqhnPackageId: { in: pagePackageIds } },
        assessment: { isNot: null }
      },
      select: historySelect
    });

    const grouped = new Map<string, StqhnHistoryPackage>();
    for (const question of rows) {
      const stqhn = question.stqhnQuestion!;
      const assessment = question.assessment!;
      const packageId = stqhn.stqhnPackage.id;
      const item = {
        questionId: question.id,
        stqhnQuestionId: stqhn.id,
        questionCode: stqhn.questionId,
        questionOrder: stqhn.questionNoForParticipant,
        competitionBranch: stqhn.competitionBranch,
        competitionDay: stqhn.competitionDay,
        passageRange: stqhn.passageRange,
        assessment: assessment.assessment,
        belCount: assessment.belCount ?? 0,
        tuntunCount: assessment.tuntunCount ?? 0,
        fragmentText: question.visibleFragmentText,
        revealedVerses:
          question.revealedVersesJson as unknown as RevealedAyah[],
        sourceVideoUrl: withTimestamp(
          stqhn.sourceYoutubeUrl,
          stqhn.timestampStartSec
        ),
        assessedAt: assessment.createdAt.toISOString()
      } satisfies StqhnHistoryItem;

      const existing = grouped.get(packageId);
      if (existing) {
        existing.questions.push(item);
      } else {
        grouped.set(packageId, {
          packageId,
          competitionBranch: stqhn.competitionBranch,
          competitionDay: stqhn.competitionDay,
          participantDisplayNo: stqhn.stqhnPackage.participantDisplayNo,
          latestAssessedAt: item.assessedAt,
          questions: [item]
        });
      }
    }

    const page = pageIndex.flatMap(({ packageId, latestAssessedAt }) => {
      const pkg = grouped.get(packageId);
      if (!pkg) return [];
      return [
        {
          ...pkg,
          latestAssessedAt: latestAssessedAt.toISOString(),
          questions: pkg.questions.sort(
            (left, right) => left.questionOrder - right.questionOrder
          )
        }
      ];
    });
    return {
      items: page,
      nextCursor: hasMore ? (page.at(-1)?.packageId ?? null) : null
    };
  });
}

/**
 * Appends a `t=<seconds>s` parameter so "Lihat Video Sumber" seeks
 * straight to the question's own moment in the source recording, rather
 * than just linking the video's start. Uses the URL API rather than
 * string concatenation so this works whether sourceYoutubeUrl already
 * carries other query params (it does - `?si=...`).
 */
function withTimestamp(youtubeUrl: string, timestampStartSec: number): string {
  try {
    const url = new URL(youtubeUrl);
    url.searchParams.set("t", `${Math.max(0, Math.floor(timestampStartSec))}s`);
    return url.toString();
  } catch {
    return youtubeUrl;
  }
}
