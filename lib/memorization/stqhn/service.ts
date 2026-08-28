import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { paginateByCursor } from "@/lib/db/cursor-pagination";
import { measureServerTiming } from "@/lib/performance/timing";
import { bandForJuz } from "../cycle/constants";
import { notFoundError } from "../errors";
import { retrySerialization } from "../persistence-retry";
import { computeRevealBoundary } from "../reveal/service";
import type {
  RevealedAyah,
  StqhnBankItem,
  StqhnBankPage,
  StqhnHistoryItem,
  StqhnHistoryPage,
  StqhnQuestionDto,
  StqhnSummary
} from "../types";

const bankSelect = {
  id: true,
  questionId: true,
  competitionBranch: true,
  competitionDay: true,
  fragmentText: true,
  questions: {
    select: {
      assessment: { select: { assessment: true, createdAt: true } }
    }
  }
} satisfies Prisma.StqhnQuestionSelect;

type BankRow = Prisma.StqhnQuestionGetPayload<{ select: typeof bankSelect }>;

function bankItemFromRow(row: BankRow): StqhnBankItem {
  // The caller's query already scopes `questions` to `where: { userId }`
  // (see getStqhnBank below), and @@unique([userId, stqhnQuestionId]) on
  // MemorizationQuestion guarantees at most one match - so row.questions
  // holds zero or one item, never more, for whichever user issued the
  // query.
  const question = row.questions[0];
  if (!question) {
    return {
      stqhnQuestionId: row.id,
      questionCode: row.questionId,
      competitionBranch: row.competitionBranch,
      competitionDay: row.competitionDay,
      fragmentText: row.fragmentText,
      status: "NOT_ATTEMPTED",
      lastAttemptAt: null
    };
  }
  return {
    stqhnQuestionId: row.id,
    questionCode: row.questionId,
    competitionBranch: row.competitionBranch,
    competitionDay: row.competitionDay,
    fragmentText: row.fragmentText,
    status: question.assessment
      ? question.assessment.assessment
      : "IN_PROGRESS",
    lastAttemptAt: question.assessment?.createdAt.toISOString() ?? null
  };
}

/**
 * Lists the full STQHN 2025 bank (372 shared hifzh questions, the same
 * for every user) paginated by the bank's own stable questionId (e.g.
 * "V1-P01-Q01", globally unique and already in natural
 * video/participant/question order - see lib/quran/stqhn/import.ts).
 * Each item's status/lastAttemptAt reflect this user's own frozen
 * main-cycle assessment against it, if any - unaffected by later
 * Evaluation Practice re-attempts, exactly like the main flow and
 * Evaluation Bank.
 *
 * Deliberately does not select/return startVerseKey, endVerseKey, or
 * passageRange (see AGENT.md "Hidden Metadata Rule"): those identify
 * exactly which ayat to expect, so the client only ever sees the same
 * short Arabic fragment teaser used everywhere else pre-selection.
 */
export async function getStqhnBank(
  userId: string,
  cursor: string | null,
  limit: number
): Promise<StqhnBankPage> {
  return measureServerTiming("stqhn_bank", async () => {
    const page = await paginateByCursor(
      (args) =>
        prisma.stqhnQuestion.findMany({
          orderBy: { questionId: "asc" },
          select: {
            ...bankSelect,
            questions: {
              where: { userId },
              select: bankSelect.questions.select
            }
          },
          ...args
        }),
      cursor,
      limit,
      (row) => bankItemFromRow(row),
      (row) => row.id
    );
    return page;
  });
}

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

const stqhnSourceForCreateSelect = {
  id: true,
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

const attemptQuestionSelect = {
  id: true,
  visibleFragmentText: true,
  revealedAyahCount: true,
  revealTotalAyahCount: true,
  revealedVersesJson: true,
  assessment: { select: { assessment: true } }
} satisfies Prisma.MemorizationQuestionSelect;

function questionDto(
  stqhnQuestionId: string,
  question: {
    id: string;
    visibleFragmentText: string;
    revealedAyahCount: number;
    revealTotalAyahCount: number;
    revealedVersesJson: Prisma.JsonValue;
    assessment: { assessment: string } | null;
  }
): StqhnQuestionDto {
  return {
    questionId: question.id,
    stqhnQuestionId,
    fragmentText: question.visibleFragmentText,
    reveal: {
      revealedAyahCount: question.revealedAyahCount,
      totalAyahCount: question.revealTotalAyahCount,
      isComplete: question.revealedAyahCount >= question.revealTotalAyahCount,
      verses: question.revealedVersesJson as unknown as RevealedAyah[]
    },
    assessment:
      (question.assessment?.assessment as StqhnQuestionDto["assessment"]) ??
      null
  };
}

/**
 * Gets or lazily creates the per-user MemorizationQuestion for an STQHN
 * bank item - the same "get or create" shape as
 * lib/memorization/evaluation/service.ts's getOrCreateEvaluationSession,
 * just producing a real MemorizationQuestion (so reveal/hint/assessment
 * all reuse the existing endpoints unmodified) instead of an
 * EvaluationSession.
 *
 * Created once per (user, stqhnQuestion) - enforced by
 * @@unique([userId, stqhnQuestionId]) - and then permanent: revisiting
 * the same bank item always resumes the same row, whatever its current
 * reveal/assessment state. cycleId/packageId/orderInPackage are left
 * null (this question is not part of the 604-page cycle);
 * pagePositionBucket is set to "START" as a fixed convention for every
 * STQHN question, since the fragment always starts at the beginning of
 * its anchor ayah - there is no page-region selection to record the way
 * there is for a cycle-plan-generated question.
 */
export async function getOrCreateStqhnAttempt(
  userId: string,
  stqhnQuestionId: string
): Promise<StqhnQuestionDto> {
  return measureServerTiming("stqhn_attempt_get_or_create", () =>
    retrySerialization(() =>
      prisma.$transaction(
        async (tx) => {
          const existing = await tx.memorizationQuestion.findUnique({
            where: { userId_stqhnQuestionId: { userId, stqhnQuestionId } },
            select: attemptQuestionSelect
          });
          if (existing) {
            return questionDto(stqhnQuestionId, existing);
          }

          const source = await tx.stqhnQuestion.findUnique({
            where: { id: stqhnQuestionId },
            select: stqhnSourceForCreateSelect
          });
          if (!source) throw notFoundError();

          const boundary = await computeRevealBoundary(
            tx,
            source.anchorVerseId,
            source.anchorVerse.pageNumber,
            source.fragmentStartWord.lineNumber
          );

          try {
            const created = await tx.memorizationQuestion.create({
              data: {
                userId,
                stqhnQuestionId,
                state: "ACTIVE",
                primaryPageNumber: source.anchorVerse.pageNumber,
                juzNumber: source.anchorVerse.juzNumber,
                juzBand: bandForJuz(source.anchorVerse.juzNumber),
                surahId: source.anchorVerse.chapterId,
                anchorVerseId: source.anchorVerseId,
                anchorVerseKey: source.anchorVerse.verseKey,
                pagePositionBucket: "START",
                fragmentStartWordId: source.fragmentStartWordId,
                initialWordCount: source.initialWordCount,
                visibleWordCount: source.initialWordCount,
                visibleFragmentText: source.fragmentText,
                revealBoundaryVerseId: boundary.boundaryVerseId,
                revealTotalAyahCount: boundary.totalAyahCount
              },
              select: attemptQuestionSelect
            });
            return questionDto(stqhnQuestionId, created);
          } catch (error) {
            if (
              error instanceof Prisma.PrismaClientKnownRequestError &&
              error.code === "P2002"
            ) {
              // Lost a race to a concurrent selection of the same bank
              // item (e.g. a double-click/double-tap) - @@unique([userId,
              // stqhnQuestionId]) means the winner's row is exactly what
              // this call would have returned anyway, so resume it
              // instead of surfacing a spurious conflict for what the
              // user experiences as a single click.
              const winner = await tx.memorizationQuestion.findUniqueOrThrow({
                where: { userId_stqhnQuestionId: { userId, stqhnQuestionId } },
                select: attemptQuestionSelect
              });
              return questionDto(stqhnQuestionId, winner);
            }
            throw error;
          }
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 15_000
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
      competitionBranch: true,
      competitionDay: true,
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
 * Only ever returns assessed questions (assessment is required below),
 * each including the source video link with a timestamp - safe here
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
    const page = await paginateByCursor(
      (args) =>
        prisma.memorizationQuestion.findMany({
          where: {
            userId,
            stqhnQuestionId: { not: null },
            assessment: { isNot: null }
          },
          orderBy: [{ assessment: { createdAt: "desc" } }, { id: "desc" }],
          select: historySelect,
          ...args
        }),
      cursor,
      limit,
      (question) => {
        const stqhn = question.stqhnQuestion!;
        const assessment = question.assessment!;
        return {
          questionId: question.id,
          stqhnQuestionId: stqhn.id,
          questionCode: stqhn.questionId,
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
      },
      (question) => question.id
    );
    return page;
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
