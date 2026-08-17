import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { QuranProvider } from "../provider/types";
import { classifyPageBand } from "../validation/page-band";
import { validateQuranData } from "../validation/validate";

type ChapterRow = {
  id: number;
  nameArabic: string;
  nameSimple: string;
  nameTransliterated: string;
  translatedName: string | null;
  versesCount: number;
  revelationPlace: string | null;
  bismillahPre: boolean;
};

type PageRow = {
  pageNumber: number;
  juzBand: "A" | "B" | "C";
  firstJuz: number;
  lastJuz: number;
  wordCount: number;
};

type VerseRow = {
  id: number;
  verseKey: string;
  chapterId: number;
  verseNumber: number;
  globalOrder: number;
  juzNumber: number;
  pageNumber: number;
  textUthmani: string;
  textUthmaniSimple: string | null;
};

type WordRow = {
  id: number;
  verseId: number;
  verseKey: string;
  position: number;
  globalOrder: number;
  pageNumber: number;
  lineNumber: number | null;
  textUthmani: string;
  charTypeName: string;
  location: string | null;
};

/**
 * Staged sync: the entire provider payload is fetched and structurally
 * pre-validated in memory before a single row is written. Persistence is
 * upsert-only (INSERT ... ON CONFLICT DO UPDATE) inside one transaction -
 * existing rows are never deleted, so a mid-sync failure or a sync that
 * runs while users already have progress (MemorizationQuestion rows hold
 * a RESTRICT foreign key into QuranPage) can never leave the app without
 * Quran data. See docs/quran-data-integrity.md.
 */
export async function syncQuranData(provider: QuranProvider) {
  const run = await prisma.quranSyncRun.create({
    data: { source: "quran-foundation-content-api", status: "RUNNING" }
  });

  try {
    const chapters = await withRetry(() => provider.getChapters());
    const verseById = new Map<number, Awaited<ReturnType<QuranProvider["getVersesByPage"]>>[number]>();
    const wordById = new Map<
      number,
      Awaited<ReturnType<QuranProvider["getVersesByPage"]>>[number]["words"][number] & {
        verseId: number;
        chapterId: number;
        juzNumber: number;
      }
    >();
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

    const chapterRows: ChapterRow[] = chapters.map((chapter) => ({
      id: chapter.id,
      nameArabic: chapter.nameArabic,
      nameSimple: chapter.nameSimple,
      nameTransliterated: chapter.nameTransliterated,
      translatedName: chapter.translatedName ?? null,
      versesCount: chapter.versesCount,
      revelationPlace: chapter.revelationPlace ?? null,
      bismillahPre: chapter.bismillahPre
    }));

    const pageRows: PageRow[] = Array.from({ length: 604 }, (_, index) => {
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

    const verseRows: VerseRow[] = verses.map((verse, index) => ({
      id: verse.id,
      verseKey: verse.verseKey,
      chapterId: verse.chapterId,
      verseNumber: verse.verseNumber,
      globalOrder: index + 1,
      juzNumber: verse.juzNumber,
      pageNumber: verse.pageNumber,
      textUthmani: verse.textUthmani,
      textUthmaniSimple: verse.textUthmaniSimple ?? null
    }));

    const wordRows: WordRow[] = words.map((word, index) => ({
      id: word.id,
      verseId: word.verseId,
      verseKey: word.verseKey,
      position: word.position,
      globalOrder: index + 1,
      pageNumber: word.pageNumber,
      lineNumber: word.lineNumber ?? null,
      textUthmani: word.textUthmani,
      charTypeName: word.charTypeName,
      location: word.location ?? null
    }));

    const preflightErrors = preflightValidate({
      chapterRows,
      pageRows,
      verseRows,
      wordRows
    });
    if (preflightErrors.length > 0) {
      throw new Error(
        `Quran sync payload failed pre-write validation, no data was written:\n${preflightErrors.join("\n")}`
      );
    }

    await prisma.$transaction(
      async (tx) => {
        await upsertChapters(tx, chapterRows);
        await upsertPages(tx, pageRows);
        await upsertVerses(tx, verseRows);
        await upsertWords(tx, wordRows);
      },
      { timeout: 300_000, maxWait: 30_000 }
    );

    const validation = await validateQuranData();
    await prisma.quranSyncRun.update({
      where: { id: run.id },
      data: {
        status: validation.ok ? "COMPLETED" : "FAILED",
        completedAt: new Date(),
        message: validation.errors.join("\n") || null,
        chapters: chapterRows.length,
        pages: pageRows.length,
        verses: verseRows.length,
        words: wordRows.length
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

function preflightValidate(payload: {
  chapterRows: ChapterRow[];
  pageRows: PageRow[];
  verseRows: VerseRow[];
  wordRows: WordRow[];
}) {
  const errors: string[] = [];
  if (payload.chapterRows.length !== 114) {
    errors.push(`Expected 114 chapters from provider, got ${payload.chapterRows.length}`);
  }
  if (payload.pageRows.length !== 604) {
    errors.push(`Expected 604 pages from provider, got ${payload.pageRows.length}`);
  }
  if (payload.verseRows.length !== 6236) {
    errors.push(`Expected 6236 verses from provider, got ${payload.verseRows.length}`);
  }
  if (payload.wordRows.length === 0) {
    errors.push("Provider returned zero words");
  }
  const duplicateVerseKeys = new Set<string>();
  const seenVerseKeys = new Set<string>();
  for (const verse of payload.verseRows) {
    if (seenVerseKeys.has(verse.verseKey)) duplicateVerseKeys.add(verse.verseKey);
    seenVerseKeys.add(verse.verseKey);
  }
  if (duplicateVerseKeys.size > 0) {
    errors.push(`Provider payload contains duplicate verse keys: ${[...duplicateVerseKeys].slice(0, 5).join(", ")}`);
  }
  const verseIds = new Set(payload.verseRows.map((verse) => verse.id));
  const orphanWords = payload.wordRows.filter((word) => !verseIds.has(word.verseId));
  if (orphanWords.length > 0) {
    errors.push(`Provider payload contains ${orphanWords.length} word(s) referencing an unknown verse id`);
  }
  return errors;
}

async function upsertChapters(tx: Prisma.TransactionClient, rows: readonly ChapterRow[]) {
  for (const batch of chunks(rows, 500)) {
    const values = Prisma.join(
      batch.map(
        (row) =>
          Prisma.sql`(${row.id}, ${row.nameArabic}, ${row.nameSimple}, ${row.nameTransliterated}, ${row.translatedName}, ${row.versesCount}, ${row.revelationPlace}, ${row.bismillahPre})`
      )
    );
    await tx.$executeRaw`
      INSERT INTO "QuranChapter" (id, "nameArabic", "nameSimple", "nameTransliterated", "translatedName", "versesCount", "revelationPlace", "bismillahPre")
      VALUES ${values}
      ON CONFLICT (id) DO UPDATE SET
        "nameArabic" = EXCLUDED."nameArabic",
        "nameSimple" = EXCLUDED."nameSimple",
        "nameTransliterated" = EXCLUDED."nameTransliterated",
        "translatedName" = EXCLUDED."translatedName",
        "versesCount" = EXCLUDED."versesCount",
        "revelationPlace" = EXCLUDED."revelationPlace",
        "bismillahPre" = EXCLUDED."bismillahPre"
    `;
  }
}

async function upsertPages(tx: Prisma.TransactionClient, rows: readonly PageRow[]) {
  for (const batch of chunks(rows, 500)) {
    const values = Prisma.join(
      batch.map(
        (row) =>
          Prisma.sql`(${row.pageNumber}, ${row.juzBand}::"JuzBand", ${row.firstJuz}, ${row.lastJuz}, ${row.wordCount})`
      )
    );
    await tx.$executeRaw`
      INSERT INTO "QuranPage" ("pageNumber", "juzBand", "firstJuz", "lastJuz", "wordCount")
      VALUES ${values}
      ON CONFLICT ("pageNumber") DO UPDATE SET
        "juzBand" = EXCLUDED."juzBand",
        "firstJuz" = EXCLUDED."firstJuz",
        "lastJuz" = EXCLUDED."lastJuz",
        "wordCount" = EXCLUDED."wordCount"
    `;
  }
}

async function upsertVerses(tx: Prisma.TransactionClient, rows: readonly VerseRow[]) {
  for (const batch of chunks(rows, 1000)) {
    const values = Prisma.join(
      batch.map(
        (row) =>
          Prisma.sql`(${row.id}, ${row.verseKey}, ${row.chapterId}, ${row.verseNumber}, ${row.globalOrder}, ${row.juzNumber}, ${row.pageNumber}, ${row.textUthmani}, ${row.textUthmaniSimple})`
      )
    );
    await tx.$executeRaw`
      INSERT INTO "QuranVerse" (id, "verseKey", "chapterId", "verseNumber", "globalOrder", "juzNumber", "pageNumber", "textUthmani", "textUthmaniSimple")
      VALUES ${values}
      ON CONFLICT (id) DO UPDATE SET
        "verseKey" = EXCLUDED."verseKey",
        "chapterId" = EXCLUDED."chapterId",
        "verseNumber" = EXCLUDED."verseNumber",
        "globalOrder" = EXCLUDED."globalOrder",
        "juzNumber" = EXCLUDED."juzNumber",
        "pageNumber" = EXCLUDED."pageNumber",
        "textUthmani" = EXCLUDED."textUthmani",
        "textUthmaniSimple" = EXCLUDED."textUthmaniSimple"
    `;
  }
}

async function upsertWords(tx: Prisma.TransactionClient, rows: readonly WordRow[]) {
  for (const batch of chunks(rows, 1500)) {
    const values = Prisma.join(
      batch.map(
        (row) =>
          Prisma.sql`(${row.id}, ${row.verseId}, ${row.verseKey}, ${row.position}, ${row.globalOrder}, ${row.pageNumber}, ${row.lineNumber}, ${row.textUthmani}, ${row.charTypeName}, ${row.location})`
      )
    );
    await tx.$executeRaw`
      INSERT INTO "QuranWord" (id, "verseId", "verseKey", position, "globalOrder", "pageNumber", "lineNumber", "textUthmani", "charTypeName", location)
      VALUES ${values}
      ON CONFLICT (id) DO UPDATE SET
        "verseId" = EXCLUDED."verseId",
        "verseKey" = EXCLUDED."verseKey",
        position = EXCLUDED.position,
        "globalOrder" = EXCLUDED."globalOrder",
        "pageNumber" = EXCLUDED."pageNumber",
        "lineNumber" = EXCLUDED."lineNumber",
        "textUthmani" = EXCLUDED."textUthmani",
        "charTypeName" = EXCLUDED."charTypeName",
        location = EXCLUDED.location
    `;
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
