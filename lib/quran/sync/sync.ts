import { prisma } from "@/lib/db/prisma";
import type { QuranProvider } from "../provider/types";
import { classifyPageBand } from "../validation/page-band";
import { validateQuranData } from "../validation/validate";

export async function syncQuranData(provider: QuranProvider) {
  const run = await prisma.quranSyncRun.create({
    data: { source: "quran-foundation-content-api", status: "RUNNING" }
  });

  try {
    const chapters = await withRetry(() => provider.getChapters());
    const verseById = new Map<number, Awaited<ReturnType<QuranProvider["getVersesByPage"]>>[number]>();
    const wordById = new Map<number, Awaited<ReturnType<QuranProvider["getVersesByPage"]>>[number]["words"][number] & { verseId: number; chapterId: number; juzNumber: number }>();
    const pageWords = new Map<number, { juzNumber: number; globalOrder: number }[]>();

    for (let pageNumber = 1; pageNumber <= 604; pageNumber += 1) {
      const verses = await withRetry(() => provider.getVersesByPage(pageNumber));
      for (const verse of verses) {
        verseById.set(verse.id, verse);
        for (const word of verse.words) {
          wordById.set(word.id, {
            ...word,
            verseId: verse.id,
            chapterId: verse.chapterId,
            juzNumber: verse.juzNumber
          });
        }
      }
    }

    const verses = [...verseById.values()].sort((a, b) => a.id - b.id);
    const words = [...wordById.values()].sort((a, b) => a.id - b.id);
    for (const [index, word] of words.entries()) {
      const list = pageWords.get(word.pageNumber) ?? [];
      list.push({ juzNumber: word.juzNumber, globalOrder: index + 1 });
      pageWords.set(word.pageNumber, list);
    }
    const wordRows = words.map((word, index) => ({
      id: word.id,
      verseId: word.verseId,
      verseKey: word.verseKey,
      position: word.position,
      globalOrder: index + 1,
      pageNumber: word.pageNumber,
      lineNumber: word.lineNumber,
      textUthmani: word.textUthmani,
      charTypeName: word.charTypeName,
      location: word.location
    }));

    const pages = Array.from({ length: 604 }, (_, index) => {
      const pageNumber = index + 1;
      const wordsForPage = pageWords.get(pageNumber) ?? [];
      const band = classifyPageBand(wordsForPage);
      return {
        pageNumber,
        juzBand: band.juzBand,
        firstJuz: band.firstJuz,
        lastJuz: band.lastJuz,
        wordCount: wordsForPage.length
      };
    });

    await prisma.quranWord.deleteMany();
    await prisma.quranVerse.deleteMany();
    await prisma.quranPage.deleteMany();
    await prisma.quranChapter.deleteMany();

    await prisma.quranChapter.createMany({ data: chapters });
    await prisma.quranPage.createMany({ data: pages });
    await prisma.quranVerse.createMany({
      data: verses.map((verse, index) => ({
        id: verse.id,
        verseKey: verse.verseKey,
        chapterId: verse.chapterId,
        verseNumber: verse.verseNumber,
        globalOrder: index + 1,
        juzNumber: verse.juzNumber,
        pageNumber: verse.pageNumber,
        textUthmani: verse.textUthmani,
        textUthmaniSimple: verse.textUthmaniSimple
      }))
    });
    for (const chunk of chunks(wordRows, 1000)) {
      await prisma.quranWord.createMany({ data: chunk });
    }

    const validation = await validateQuranData();
    await prisma.quranSyncRun.update({
      where: { id: run.id },
      data: {
        status: validation.ok ? "COMPLETED" : "FAILED",
        completedAt: new Date(),
        message: validation.errors.join("\n") || null,
        chapters: chapters.length,
        pages: 604,
        verses: verses.length,
        words: words.length
      }
    });
    if (!validation.ok) throw new Error(validation.errors.join("\n"));
    return validation;
  } catch (error) {
    await prisma.quranSyncRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        message: error instanceof Error ? error.message : "Unknown sync error"
      }
    });
    throw error;
  }
}

function chunks<T>(items: readonly T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw lastError;
}
