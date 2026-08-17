import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { productConfig } from "@/lib/config";
import {
  createCyclePlan,
  validateCyclePlan
} from "@/lib/memorization/cycle/plan";
import { SeededRandomSource } from "@/lib/memorization/random";

export type QuranValidationResult = {
  ok: boolean;
  errors: string[];
  counts: {
    chapters: number;
    pages: number;
    verses: number;
    words: number;
  };
};

/**
 * Accepts an optional client so this can run either standalone (the
 * default top-level `prisma`, used by `npm run quran:validate` and
 * anywhere else outside a transaction) or against a `tx` from inside
 * syncQuranData's transaction, where it gates the commit itself - a
 * failure there aborts the transaction, so a sync that fails validation
 * can never leave the live tables in a half-updated state.
 */
export async function validateQuranData(
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<QuranValidationResult> {
  const errors: string[] = [];
  const chapters = await client.quranChapter.count();
  const pages = await client.quranPage.count();
  const verses = await client.quranVerse.count();
  const words = await client.quranWord.count();

  if (chapters !== 114) errors.push(`Expected 114 chapters, found ${chapters}`);
  if (pages !== productConfig.mushafPages)
    errors.push(`Expected 604 pages, found ${pages}`);
  if (verses !== 6236) errors.push(`Expected 6236 verses, found ${verses}`);
  if (words !== 77430) errors.push(`Expected 77430 words, found ${words}`);

  const duplicateVerseKeys = await client.quranVerse.groupBy({
    by: ["verseKey"],
    _count: { verseKey: true },
    having: { verseKey: { _count: { gt: 1 } } }
  });
  if (duplicateVerseKeys.length > 0)
    errors.push("Duplicate verse keys detected");

  const invalidJuz = await client.quranVerse.count({
    where: { OR: [{ juzNumber: { lt: 1 } }, { juzNumber: { gt: 30 } }] }
  });
  if (invalidJuz > 0)
    errors.push(`Found ${invalidJuz} verses with invalid juz numbers`);

  const invalidPages = await client.quranVerse.count({
    where: { OR: [{ pageNumber: { lt: 1 } }, { pageNumber: { gt: 604 } }] }
  });
  if (invalidPages > 0)
    errors.push(`Found ${invalidPages} verses with invalid page numbers`);

  // globalOrder uniqueness is already guaranteed by a DB constraint (see
  // prisma/migrations/20260818090000_make_global_order_constraints_deferrable),
  // so true duplicates cannot exist here - what a unique constraint alone
  // does NOT guarantee is that the values are gapless/contiguous (e.g.
  // 1,2,4,5 skipping 3 is still unique). A set of N distinct positive
  // integers is exactly {1..N} - no gaps, no values beyond N - if and
  // only if its min is 1 and its max is N, so this is a cheap aggregate
  // check rather than an explicit gap scan.
  if (verses > 0) {
    const [verseRange] = await client.$queryRaw<
      { min: number | null; max: number | null }[]
    >`SELECT MIN("globalOrder") AS min, MAX("globalOrder") AS max FROM "QuranVerse"`;
    if (verseRange.min !== 1 || verseRange.max !== verses) {
      errors.push(
        `QuranVerse.globalOrder is not gapless/contiguous: expected range 1..${verses}, found ${verseRange.min}..${verseRange.max}`
      );
    }
  }
  if (words > 0) {
    const [wordRange] = await client.$queryRaw<
      { min: number | null; max: number | null }[]
    >`SELECT MIN("globalOrder") AS min, MAX("globalOrder") AS max FROM "QuranWord"`;
    if (wordRange.min !== 1 || wordRange.max !== words) {
      errors.push(
        `QuranWord.globalOrder is not gapless/contiguous: expected range 1..${words}, found ${wordRange.min}..${wordRange.max}`
      );
    }
  }

  // Also already guaranteed structurally (QuranWord.verseId carries a
  // NOT NULL foreign key onto QuranVerse.id - Prisma's generated filter
  // type has no "is: null" shape for a required relation, which is why
  // this is raw SQL rather than a `quranWord.count({ where: ... })`
  // call), but checked explicitly and cheaply here so the validator
  // states the invariant itself, not just trusts that the constraint
  // enforcing it was never weakened.
  const [{ count: orphanWords }] = await client.$queryRaw<
    { count: number }[]
  >`SELECT COUNT(*)::int AS count FROM "QuranWord" w LEFT JOIN "QuranVerse" v ON v.id = w."verseId" WHERE v.id IS NULL`;
  if (orphanWords > 0)
    errors.push(`Found ${orphanWords} words not linked to a real verse`);

  if (pages === productConfig.mushafPages) {
    const pageDeck = await client.quranPage.findMany({
      select: { pageNumber: true, juzBand: true },
      orderBy: { pageNumber: "asc" }
    });
    try {
      const plan = createCyclePlan(
        pageDeck,
        "validation",
        new SeededRandomSource("validation")
      );
      validateCyclePlan(plan);
    } catch (error) {
      errors.push(
        error instanceof Error ? error.message : "Cycle validation failed"
      );
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    counts: { chapters, pages, verses, words }
  };
}
