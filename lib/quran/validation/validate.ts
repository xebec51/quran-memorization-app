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

export async function validateQuranData(): Promise<QuranValidationResult> {
  const errors: string[] = [];
  const [chapters, pages, verses, words] = await Promise.all([
    prisma.quranChapter.count(),
    prisma.quranPage.count(),
    prisma.quranVerse.count(),
    prisma.quranWord.count()
  ]);

  if (chapters !== 114) errors.push(`Expected 114 chapters, found ${chapters}`);
  if (pages !== productConfig.mushafPages)
    errors.push(`Expected 604 pages, found ${pages}`);
  if (verses !== 6236) errors.push(`Expected 6236 verses, found ${verses}`);
  if (words <= 0) errors.push("Expected Quran words to be synchronized");

  const duplicateVerseKeys = await prisma.quranVerse.groupBy({
    by: ["verseKey"],
    _count: { verseKey: true },
    having: { verseKey: { _count: { gt: 1 } } }
  });
  if (duplicateVerseKeys.length > 0)
    errors.push("Duplicate verse keys detected");

  const invalidJuz = await prisma.quranVerse.count({
    where: { OR: [{ juzNumber: { lt: 1 } }, { juzNumber: { gt: 30 } }] }
  });
  if (invalidJuz > 0)
    errors.push(`Found ${invalidJuz} verses with invalid juz numbers`);

  const invalidPages = await prisma.quranVerse.count({
    where: { OR: [{ pageNumber: { lt: 1 } }, { pageNumber: { gt: 604 } }] }
  });
  if (invalidPages > 0)
    errors.push(`Found ${invalidPages} verses with invalid page numbers`);

  if (pages === productConfig.mushafPages) {
    const pageDeck = await prisma.quranPage.findMany({
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
