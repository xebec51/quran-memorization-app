import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { QuranProvider } from "../provider/types";
import { classifyPageBand } from "../validation/page-band";
import { validateQuranData } from "../validation/validate";

type StaleRowReport = {
  staleVerseIds: number[];
  staleWordIds: number[];
};

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
    const verseById = new Map<
      number,
      Awaited<ReturnType<QuranProvider["getVersesByPage"]>>[number]
    >();
    const wordById = new Map<
      number,
      Awaited<
        ReturnType<QuranProvider["getVersesByPage"]>
      >[number]["words"][number] & {
        verseId: number;
        chapterId: number;
        verseNumber: number;
        juzNumber: number;
      }
    >();
    const pageWords = new Map<
      number,
      { juzNumber: number; globalOrder: number }[]
    >();

    for (let pageNumber = 1; pageNumber <= 604; pageNumber += 1) {
      const verses = await withRetry(() =>
        provider.getVersesByPage(pageNumber)
      );
      for (const verse of verses) {
        verseById.set(verse.id, verse);
        for (const word of verse.words) {
          wordById.set(word.id, {
            ...word,
            verseId: verse.id,
            chapterId: verse.chapterId,
            verseNumber: verse.verseNumber,
            juzNumber: verse.juzNumber
          });
        }
      }
    }

    // Verse ids from the provider are already globally sequential in
    // canonical Quran order (verified against (chapterId, verseNumber)),
    // so sorting by id is safe. Word ids are NOT: they reset/are not
    // monotonic across at least 113 of the 114 surah boundaries, which
    // corrupted word-level globalOrder (and therefore page-boundary
    // reasoning) for any page that ends one surah and starts the next.
    // Sort by the word's true canonical position instead.
    const verses = [...verseById.values()].sort((a, b) => a.id - b.id);
    const words = [...wordById.values()].sort(
      (a, b) =>
        a.chapterId - b.chapterId ||
        a.verseNumber - b.verseNumber ||
        a.position - b.position
    );
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

    const validation = await prisma.$transaction(
      async (tx) => {
        // globalOrder's uniqueness is DEFERRABLE INITIALLY DEFERRED (see
        // migration 20260818090000_make_global_order_constraints_deferrable)
        // so Postgres only checks it at commit, not after every row - the
        // bulk reorder below can transiently "collide" mid-batch (row A
        // takes the globalOrder value row B is about to vacate) without
        // error, and if the FINAL state is somehow not unique, COMMIT
        // itself fails and the whole transaction rolls back, so this still
        // cannot mask a genuine data problem. Explicit SET CONSTRAINTS is
        // redundant with INITIALLY DEFERRED but kept for clarity: this
        // sync depends on deferred checking, not just on whatever the
        // constraint's default happens to be.
        await tx.$executeRaw`SET CONSTRAINTS "QuranVerse_globalOrder_key", "QuranWord_globalOrder_key" DEFERRED`;

        // Checked BEFORE any upsert, not after: globalOrder is recomputed
        // every sync as a dense, gapless 1..N sequence over the CURRENT
        // payload (see verseRows/wordRows above), but a stale row left
        // behind by a past sync keeps whatever globalOrder value it was
        // last assigned - so a lingering stale row and a freshly
        // renumbered dense set are structurally incompatible, not just
        // cosmetically mismatched. Proceeding into the upsert anyway would
        // very often *still* fail (found empirically: validateQuranData's
        // exact-count or gapless check rejects it downstream in most
        // cases, since almost any removed id shifts everything after it),
        // just later and with a confusing generic error instead of a
        // clear, immediate, actionable one. Refusing here also means sync
        // never has to choose between violating "never auto-delete Quran
        // data" and violating the gapless-globalOrder invariant - it
        // simply declines to guess and asks a human to resolve it first.
        const staleRows = await findStaleRows(tx, {
          verseIds: verseRows.map((row) => row.id),
          wordIds: wordRows.map((row) => row.id)
        });
        if (
          staleRows.staleVerseIds.length > 0 ||
          staleRows.staleWordIds.length > 0
        ) {
          throw new Error(
            `Sync refused: this database has ${staleRows.staleVerseIds.length} verse(s) and ${staleRows.staleWordIds.length} word(s) that are not present in this sync's payload ` +
              `(verse ids: ${describeIds(staleRows.staleVerseIds)}; word ids: ${describeIds(staleRows.staleWordIds)}). ` +
              "Canonical Quran text is expected to be permanent, so a payload missing previously-synced ids usually means either a transient provider problem " +
              "(confirm the provider is healthy, then retry) or a genuine upstream change that needs a human to manually verify and resolve the specific row(s) " +
              "before sync can proceed - see docs/quran-data-integrity.md. Sync never automatically deletes Quran data, so it cannot resolve this on its own."
          );
        }

        await upsertChapters(tx, chapterRows);
        await upsertPages(tx, pageRows);
        await upsertVerses(tx, verseRows);
        await upsertWords(tx, wordRows);

        // Full validation runs INSIDE the transaction, before commit: if
        // it fails, the throw below aborts the transaction and every
        // upsert in it rolls back together, so the active data is never
        // left half-updated - a validation failure here means the live
        // tables are byte-for-byte whatever they were before this sync
        // started, not a mix of old and new rows.
        const validation = await validateQuranData(tx);
        if (!validation.ok) {
          throw new Error(validation.errors.join("\n"));
        }
        return validation;
      },
      { timeout: 300_000, maxWait: 30_000 }
    );

    await prisma.quranSyncRun.update({
      where: { id: run.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        chapters: chapterRows.length,
        pages: pageRows.length,
        verses: verseRows.length,
        words: wordRows.length
      }
    });
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
    errors.push(
      `Expected 114 chapters from provider, got ${payload.chapterRows.length}`
    );
  }
  if (payload.pageRows.length !== 604) {
    errors.push(
      `Expected 604 pages from provider, got ${payload.pageRows.length}`
    );
  }
  if (payload.verseRows.length !== 6236) {
    errors.push(
      `Expected 6236 verses from provider, got ${payload.verseRows.length}`
    );
  }
  if (payload.wordRows.length === 0) {
    errors.push("Provider returned zero words");
  }
  const duplicateVerseKeys = new Set<string>();
  const seenVerseKeys = new Set<string>();
  for (const verse of payload.verseRows) {
    if (seenVerseKeys.has(verse.verseKey))
      duplicateVerseKeys.add(verse.verseKey);
    seenVerseKeys.add(verse.verseKey);
  }
  if (duplicateVerseKeys.size > 0) {
    errors.push(
      `Provider payload contains duplicate verse keys: ${[...duplicateVerseKeys].slice(0, 5).join(", ")}`
    );
  }
  const verseIds = new Set(payload.verseRows.map((verse) => verse.id));
  const orphanWords = payload.wordRows.filter(
    (word) => !verseIds.has(word.verseId)
  );
  if (orphanWords.length > 0) {
    errors.push(
      `Provider payload contains ${orphanWords.length} word(s) referencing an unknown verse id`
    );
  }
  return errors;
}

async function upsertChapters(
  tx: Prisma.TransactionClient,
  rows: readonly ChapterRow[]
) {
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

async function upsertPages(
  tx: Prisma.TransactionClient,
  rows: readonly PageRow[]
) {
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

async function upsertVerses(
  tx: Prisma.TransactionClient,
  rows: readonly VerseRow[]
) {
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

async function upsertWords(
  tx: Prisma.TransactionClient,
  rows: readonly WordRow[]
) {
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

/**
 * Rows that exist in the live tables but were NOT part of this sync's
 * payload (e.g. the provider stopped returning an id it previously did).
 * Sync is upsert-only and never deletes, so this can never be resolved by
 * silently ignoring it (a genuine provider change nobody notices) or by
 * automatically deleting the row (a transient provider glitch destroying
 * real Quran data, or - since globalOrder is a dense 1..N sequence
 * recomputed from THIS payload every run - leaving a stale row in place
 * would break that invariant on this and every future sync anyway). See
 * the "never erase valid Quran data" rule in AGENT.md. The caller checks
 * this BEFORE any upsert and refuses the whole sync if it finds anything,
 * rather than letting it proceed into a state validateQuranData would
 * very likely reject downstream regardless.
 */
async function findStaleRows(
  tx: Prisma.TransactionClient,
  current: { verseIds: readonly number[]; wordIds: readonly number[] }
): Promise<StaleRowReport> {
  // Sequential, not Promise.all: `tx` is a single interactive-transaction
  // client bound to one reserved connection - see the same fix elsewhere
  // in this codebase (lib/memorization/service.ts, reveal/service.ts).
  //
  // Raw SQL with a single array-typed parameter (`= ANY($1::int[])`)
  // rather than Prisma's `notIn: [...]`, which compiles to one bind
  // parameter PER array element - a real sync payload has 6236 verse ids
  // and 77430 word ids, and Postgres's wire protocol caps a single Bind
  // message at 65535 parameters, so `notIn` on the word-id list alone
  // would exceed the limit and fail every real sync.
  const staleVerses = await tx.$queryRaw<{ id: number }[]>`
    SELECT id FROM "QuranVerse" WHERE NOT (id = ANY(${[...current.verseIds]}::int[]))
  `;
  const staleWords = await tx.$queryRaw<{ id: number }[]>`
    SELECT id FROM "QuranWord" WHERE NOT (id = ANY(${[...current.wordIds]}::int[]))
  `;
  return {
    staleVerseIds: staleVerses.map((row) => row.id),
    staleWordIds: staleWords.map((row) => row.id)
  };
}

/** First 20 ids plus a total, so a refusal error stays readable even when hundreds of rows are stale. */
function describeIds(ids: readonly number[]): string {
  if (ids.length === 0) return "none";
  const shown = ids.slice(0, 20).join(", ");
  return ids.length > 20 ? `${shown}, ... (${ids.length} total)` : shown;
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
