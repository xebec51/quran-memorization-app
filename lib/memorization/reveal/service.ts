import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { productConfig } from "@/lib/config";
import { measureServerTiming } from "@/lib/performance/timing";
import { alreadyAssessedError, notFoundError } from "@/lib/memorization/errors";
import { retrySerialization } from "@/lib/memorization/persistence-retry";
import type { RevealMutationResult, RevealedAyah } from "../types";

/**
 * The page-boundary verse and total ayah count are computed once, at
 * question-generation time, and stored on the question - see
 * docs/memorization-engine.md "Progressive Reveal". Recomputing them here
 * would repeat the same word/verse lookups on every reveal click; storing
 * them keeps that lookup a one-time cost per question.
 *
 * Reveal must continue through the ENTIRE page after the question's
 * primary page, not stop at the end of the primary page itself - e.g. a
 * question anchored on page 1 must reveal through the last ayah touching
 * page 2 (2:5), not stop at the last ayah touching page 1 (1:7). Page 604
 * (the last Mushaf page) is its own boundary: min(primaryPageNumber + 1,
 * mushafPages) naturally handles both the general case and the
 * end-of-Quran case without a separate branch.
 *
 * "Last word by globalOrder on the boundary page" only produces the
 * correct verse because QuranWord.globalOrder follows true canonical
 * (chapter, verse, position) order - see the fix in lib/quran/sync/sync.ts.
 */
export async function computeRevealBoundary(
  tx: Prisma.TransactionClient | typeof prisma,
  anchorVerseId: number,
  primaryPageNumber: number
) {
  const boundaryPageNumber = Math.min(
    primaryPageNumber + 1,
    productConfig.mushafPages
  );
  const lastWordOnPage = await tx.quranWord.findFirst({
    where: { pageNumber: boundaryPageNumber, charTypeName: "word" },
    orderBy: { globalOrder: "desc" },
    select: { verseId: true }
  });
  if (!lastWordOnPage) {
    throw new Error(
      `No words found for page ${boundaryPageNumber}; run quran:sync first.`
    );
  }

  // Sequential, not Promise.all: Prisma's interactive-transaction client
  // (`tx`) is bound to a single reserved connection and does not support
  // concurrent queries issued against it - see the reveal/allocation
  // concurrency fix in this file's history for the P2028 failures that
  // caused.
  const anchor = await tx.quranVerse.findUniqueOrThrow({
    where: { id: anchorVerseId },
    select: { globalOrder: true }
  });
  const boundary = await tx.quranVerse.findUniqueOrThrow({
    where: { id: lastWordOnPage.verseId },
    select: { globalOrder: true }
  });

  if (boundary.globalOrder < anchor.globalOrder) {
    throw new Error(
      `Reveal boundary verse (globalOrder ${boundary.globalOrder}) precedes anchor verse (globalOrder ${anchor.globalOrder}) for page ${primaryPageNumber} - Quran data integrity problem, not a user error.`
    );
  }

  // QuranVerse.globalOrder is a contiguous, gapless sequence assigned as
  // index+1 over canonically-sorted verses (see lib/quran/sync/sync.ts) -
  // the verse count between two globalOrder values is therefore pure
  // arithmetic, not a query.
  const totalAyahCount = boundary.globalOrder - anchor.globalOrder + 1;

  return { boundaryVerseId: lastWordOnPage.verseId, totalAyahCount };
}

/**
 * Batched form of computeRevealBoundary for allocating an entire package
 * (up to 4 questions) at once: 2 queries total regardless of question
 * count, instead of up to 3 sequential queries PER question (up to 12 for
 * a 4-question package) - the boundary-page lookup and the anchor/
 * boundary globalOrder lookups are each done once for every question
 * together, not once per question.
 */
export async function computeRevealBoundariesBulk(
  tx: Prisma.TransactionClient | typeof prisma,
  sources: readonly { anchorVerseId: number; primaryPageNumber: number }[]
): Promise<{ boundaryVerseId: number; totalAyahCount: number }[]> {
  if (sources.length === 0) return [];

  const boundaryPages = [
    ...new Set(
      sources.map((source) =>
        Math.min(source.primaryPageNumber + 1, productConfig.mushafPages)
      )
    )
  ];

  const lastWordRows = await tx.$queryRaw<
    { pageNumber: number; verseId: number }[]
  >(Prisma.sql`
    SELECT DISTINCT ON (w."pageNumber") w."pageNumber", w."verseId"
    FROM "QuranWord" w
    WHERE w."pageNumber" IN (${Prisma.join(boundaryPages)}) AND w."charTypeName" = 'word'
    ORDER BY w."pageNumber", w."globalOrder" DESC
  `);
  const boundaryVerseIdByPage = new Map(
    lastWordRows.map((row) => [row.pageNumber, row.verseId])
  );
  for (const page of boundaryPages) {
    if (!boundaryVerseIdByPage.has(page)) {
      throw new Error(`No words found for page ${page}; run quran:sync first.`);
    }
  }

  const neededVerseIds = [
    ...new Set([
      ...sources.map((source) => source.anchorVerseId),
      ...boundaryVerseIdByPage.values()
    ])
  ];
  const verseRows = await tx.quranVerse.findMany({
    where: { id: { in: neededVerseIds } },
    select: { id: true, globalOrder: true }
  });
  const globalOrderByVerseId = new Map(
    verseRows.map((row) => [row.id, row.globalOrder])
  );

  return sources.map((source) => {
    const boundaryPage = Math.min(
      source.primaryPageNumber + 1,
      productConfig.mushafPages
    );
    const boundaryVerseId = boundaryVerseIdByPage.get(boundaryPage)!;
    const anchorGlobalOrder = globalOrderByVerseId.get(source.anchorVerseId);
    const boundaryGlobalOrder = globalOrderByVerseId.get(boundaryVerseId);
    if (anchorGlobalOrder === undefined || boundaryGlobalOrder === undefined) {
      throw new Error(
        "Missing verse globalOrder data while computing reveal boundary - Quran data integrity problem, not a user error."
      );
    }
    if (boundaryGlobalOrder < anchorGlobalOrder) {
      throw new Error(
        `Reveal boundary verse (globalOrder ${boundaryGlobalOrder}) precedes anchor verse (globalOrder ${anchorGlobalOrder}) for page ${source.primaryPageNumber} - Quran data integrity problem, not a user error.`
      );
    }
    return {
      boundaryVerseId,
      totalAyahCount: boundaryGlobalOrder - anchorGlobalOrder + 1
    };
  });
}

export const revealVerseSelect = {
  verseKey: true,
  textUthmani: true,
  verseNumber: true,
  juzNumber: true,
  pageNumber: true,
  globalOrder: true,
  chapter: { select: { nameTransliterated: true, nameArabic: true } }
} satisfies Prisma.QuranVerseSelect;

export function toRevealedAyah(verse: {
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
 *
 * One round trip, not two: the anchor's globalOrder is looked up in a
 * subquery evaluated by Postgres itself, not fetched separately first and
 * then used in a second query from the client - each click on the reveal
 * button pays this round-trip cost against Neon, so halving it here is a
 * real, measurable latency win on the hottest path in the app.
 */
export async function nthVerseFromAnchor(
  tx: Prisma.TransactionClient | typeof prisma,
  anchorVerseId: number,
  offset: number
): Promise<RevealedAyah> {
  const rows = await tx.$queryRaw<
    {
      verseKey: string;
      textUthmani: string;
      verseNumber: number;
      juzNumber: number;
      pageNumber: number;
      globalOrder: number;
      chapterNameTransliterated: string;
      chapterNameArabic: string;
    }[]
  >(Prisma.sql`
    SELECT v."verseKey", v."textUthmani", v."verseNumber", v."juzNumber",
           v."pageNumber", v."globalOrder",
           c."nameTransliterated" AS "chapterNameTransliterated",
           c."nameArabic" AS "chapterNameArabic"
    FROM "QuranVerse" v
    JOIN "QuranChapter" c ON c.id = v."chapterId"
    WHERE v."globalOrder" >= (
      SELECT "globalOrder" FROM "QuranVerse" WHERE id = ${anchorVerseId}
    )
    ORDER BY v."globalOrder" ASC
    OFFSET ${offset} LIMIT 1
  `);
  const verse = rows[0];
  if (!verse) {
    throw new Error(
      `No verse found at offset ${offset} from anchor verse ${anchorVerseId} - Quran data integrity problem, not a user error.`
    );
  }
  return {
    verseKey: verse.verseKey,
    text: verse.textUthmani,
    surah: `${verse.chapterNameTransliterated} (${verse.chapterNameArabic})`,
    juz: verse.juzNumber,
    page: verse.pageNumber
  };
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
    retrySerialization(() =>
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
          // A duplicate click or network retry arrives with the same
          // expectedRevealedCount it saw before; if a concurrent request
          // already advanced revealedAyahCount past that (either committed
          // by an earlier attempt in this same call via retrySerialization,
          // or by a genuinely concurrent request from another tab),
          // canAdvance is false and this just returns the current state
          // instead of advancing twice - no separate idempotency-key table
          // needed.
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
                  : {
                      answerRevealedAt: new Date(),
                      state: "ANSWER_REVEALED" as const
                    })
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
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 15_000
        }
      )
    )
  );
}
