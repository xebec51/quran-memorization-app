import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { measureServerTiming } from "@/lib/performance/timing";
import { DomainError, alreadyAssessedError, notFoundError } from "@/lib/memorization/errors";
import type { RevealMutationResult, RevealedAyah } from "../types";

/**
 * The page-boundary verse and total ayah count are computed once, at
 * question-generation time, and stored on the question - see
 * docs/memorization-engine.md "Progressive Reveal". Recomputing them here
 * would repeat the same word/verse lookups on every reveal click; storing
 * them keeps that lookup a one-time cost per question.
 *
 * "Last word by globalOrder on primaryPageNumber" only produces the
 * correct verse because QuranWord.globalOrder follows true canonical
 * (chapter, verse, position) order - see the fix in lib/quran/sync/sync.ts.
 */
export async function computeRevealBoundary(
  tx: Prisma.TransactionClient | typeof prisma,
  anchorVerseId: number,
  primaryPageNumber: number
) {
  const lastWordOnPage = await tx.quranWord.findFirst({
    where: { pageNumber: primaryPageNumber, charTypeName: "word" },
    orderBy: { globalOrder: "desc" },
    select: { verseId: true }
  });
  if (!lastWordOnPage) {
    throw new Error(`No words found for page ${primaryPageNumber}; run quran:sync first.`);
  }

  const [anchor, boundary] = await Promise.all([
    tx.quranVerse.findUniqueOrThrow({
      where: { id: anchorVerseId },
      select: { globalOrder: true }
    }),
    tx.quranVerse.findUniqueOrThrow({
      where: { id: lastWordOnPage.verseId },
      select: { globalOrder: true }
    })
  ]);

  if (boundary.globalOrder < anchor.globalOrder) {
    throw new Error(
      `Reveal boundary verse (globalOrder ${boundary.globalOrder}) precedes anchor verse (globalOrder ${anchor.globalOrder}) for page ${primaryPageNumber} - Quran data integrity problem, not a user error.`
    );
  }

  const totalAyahCount = await tx.quranVerse.count({
    where: { globalOrder: { gte: anchor.globalOrder, lte: boundary.globalOrder } }
  });

  return { boundaryVerseId: lastWordOnPage.verseId, totalAyahCount };
}

const revealVerseSelect = {
  verseKey: true,
  textUthmani: true,
  verseNumber: true,
  juzNumber: true,
  pageNumber: true,
  globalOrder: true,
  chapter: { select: { nameTransliterated: true, nameArabic: true } }
} satisfies Prisma.QuranVerseSelect;

function toRevealedAyah(verse: {
  verseKey: string;
  textUthmani: string;
  juzNumber: number;
  pageNumber: number;
  chapter: { nameTransliterated: string; nameArabic: string };
}): RevealedAyah {
  return {
    verseKey: verse.verseKey,
    text: verse.textUthmani,
    surah: `${verse.chapter.nameTransliterated} (${verse.chapter.nameArabic})`,
    juz: verse.juzNumber,
    page: verse.pageNumber
  };
}

/**
 * The single verse at position `offset` (0-indexed) after the anchor, in
 * canonical order - i.e. the exact next ayah to reveal. revealedVersesJson
 * stores every ayah revealed so far so this only ever needs to fetch the
 * one new one, not re-fetch the whole accumulated prefix on every click.
 */
async function nthVerseFromAnchor(
  tx: Prisma.TransactionClient | typeof prisma,
  anchorVerseId: number,
  offset: number
): Promise<RevealedAyah> {
  const anchor = await tx.quranVerse.findUniqueOrThrow({
    where: { id: anchorVerseId },
    select: { globalOrder: true }
  });
  const verse = await tx.quranVerse.findFirstOrThrow({
    where: { globalOrder: { gte: anchor.globalOrder } },
    orderBy: { globalOrder: "asc" },
    skip: offset,
    select: revealVerseSelect
  });
  return toRevealedAyah(verse);
}

/**
 * Advances reveal progress by exactly one ayah, guarded by
 * expectedRevealedCount as an optimistic-concurrency token: the caller
 * sends back the revealedAyahCount it last observed, and the update only
 * applies if the stored count still matches. A duplicate click or network
 * retry that arrives after the first one already landed simply observes a
 * mismatch and returns the current (already-advanced) state instead of
 * advancing twice - this is what makes the endpoint idempotent under
 * double-click/retry without needing a separate idempotency-key table.
 */
export async function revealNextAyah(
  userId: string,
  questionId: string,
  expectedRevealedCount: number
): Promise<RevealMutationResult> {
  return measureServerTiming("reveal_next_ayah", () =>
    prisma.$transaction(
      async (tx) => {
        const question = await tx.memorizationQuestion.findFirst({
          where: { id: questionId, userId },
          select: {
            id: true,
            state: true,
            anchorVerseId: true,
            revealedAyahCount: true,
            revealTotalAyahCount: true,
            revealedVersesJson: true,
            answerRevealedAt: true
          }
        });
        if (!question) throw notFoundError();
        if (question.state === "ASSESSED") throw alreadyAssessedError();

        let nextCount = question.revealedAyahCount;
        let verses = question.revealedVersesJson as unknown as RevealedAyah[];
        const canAdvance =
          question.revealedAyahCount === expectedRevealedCount &&
          question.revealedAyahCount < question.revealTotalAyahCount;

        if (canAdvance) {
          const newVerse = await nthVerseFromAnchor(
            tx,
            question.anchorVerseId,
            question.revealedAyahCount
          );
          nextCount = question.revealedAyahCount + 1;
          verses = [...verses, newVerse];
          await tx.memorizationQuestion.update({
            where: { id: question.id },
            data: {
              revealedAyahCount: nextCount,
              revealedVersesJson: verses as unknown as Prisma.InputJsonValue,
              ...(question.answerRevealedAt
                ? {}
                : { answerRevealedAt: new Date(), state: "ANSWER_REVEALED" as const })
            },
            select: { id: true }
          });
        }

        return {
          questionId: question.id,
          revealedAyahCount: nextCount,
          totalAyahCount: question.revealTotalAyahCount,
          isComplete: nextCount >= question.revealTotalAyahCount,
          verses
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 }
    ).catch((error) => {
      if (error instanceof DomainError) throw error;
      if (isRetryableConflict(error)) {
        // A genuinely concurrent request (two tabs) lost the race; the
        // caller's optimistic-concurrency retry (same expectedRevealedCount)
        // will simply see the winner's state and no-op. Surface as a normal
        // reveal-state response instead of a 500 by re-reading current state.
        return currentRevealState(userId, questionId);
      }
      throw error;
    })
  );
}

async function currentRevealState(userId: string, questionId: string): Promise<RevealMutationResult> {
  const question = await prisma.memorizationQuestion.findFirst({
    where: { id: questionId, userId },
    select: {
      id: true,
      revealedAyahCount: true,
      revealTotalAyahCount: true,
      revealedVersesJson: true
    }
  });
  if (!question) throw notFoundError();
  return {
    questionId: question.id,
    revealedAyahCount: question.revealedAyahCount,
    totalAyahCount: question.revealTotalAyahCount,
    isComplete: question.revealedAyahCount >= question.revealTotalAyahCount,
    verses: question.revealedVersesJson as unknown as RevealedAyah[]
  };
}

function isRetryableConflict(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return ["P2002", "P2034"].includes(error.code);
  }
  if (error && typeof error === "object") {
    const maybe = error as { cause?: { originalCode?: string }; name?: string };
    return maybe.cause?.originalCode === "40001" || maybe.name === "DriverAdapterError";
  }
  return false;
}
