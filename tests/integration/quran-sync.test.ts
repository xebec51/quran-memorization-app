import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { syncQuranData } from "../../lib/quran/sync/sync";
import type {
  ProviderChapter,
  ProviderVerse,
  ProviderWord,
  QuranProvider
} from "../../lib/quran/provider/types";

/**
 * Proves the rewritten syncQuranData (lib/quran/sync/sync.ts) works
 * end-to-end at realistic full-Quran scale against a real Postgres - in
 * particular that findStaleRows' `= ANY($1::int[])` fix (replacing
 * Prisma's `notIn: [...]`, which compiles to one bind parameter PER array
 * element and blows past Postgres's 65535-bind-parameter-per-message limit
 * at 77430 word ids) actually holds up, that full validation runs INSIDE
 * the sync transaction and rolls everything back atomically on failure,
 * and that stale rows are detected/reported but never deleted.
 *
 * Requires a real Postgres with all migrations applied, reachable via
 * TEST_DATABASE_URL or DATABASE_URL; skips cleanly if neither is set so
 * this never blocks the DB-free unit suite. See
 * tests/integration/setup-env.ts for how TEST_DATABASE_URL is safely
 * swapped into lib/db/prisma.ts's module-load-time DATABASE_URL read
 * before syncQuranData's `prisma` import resolves - this file must NEVER
 * be run without TEST_DATABASE_URL pointed at an isolated database, since
 * DATABASE_URL otherwise falls through to whatever real database the
 * ambient shell/`.env.local` provides.
 */
const connectionString =
  process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

type FixtureChapterRow = {
  id: number;
  nameArabic: string;
  nameSimple: string;
  nameTransliterated: string;
  translatedName: string | null;
  versesCount: number;
  revelationPlace: string | null;
  bismillahPre: boolean;
};

type FixturePageRow = {
  pageNumber: number;
  juzBand: string;
  firstJuz: number;
  lastJuz: number;
  wordCount: number;
  source?: string;
};

type FixtureVerseRow = {
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

type FixtureWordRow = {
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

type QuranDatasetFixture = {
  exportedAt: string;
  source: string;
  counts: { chapters: number; pages: number; verses: number; words: number };
  chapters: FixtureChapterRow[];
  pages: FixturePageRow[];
  verses: FixtureVerseRow[];
  words: FixtureWordRow[];
};

const fixturePath = path.join(
  import.meta.dirname,
  "../fixtures/quran-dataset.json"
);
const fixture: QuranDatasetFixture = JSON.parse(
  readFileSync(fixturePath, "utf8")
);

/**
 * Real QuranProvider backed entirely by the committed fixture (a direct
 * dump of the four Quran Prisma models from an already-synced database) -
 * no synthetic/fabricated Quran text. Pre-indexes words by pageNumber and
 * verses by id in the constructor so the 604 getVersesByPage calls
 * sync.ts makes are O(1) lookups instead of each looping all 77430 words.
 */
class FixtureQuranProvider implements QuranProvider {
  private readonly chapterRows: readonly FixtureChapterRow[];
  private readonly verseById: Map<number, FixtureVerseRow>;
  private readonly wordsByPage: Map<number, FixtureWordRow[]>;

  constructor(dataset: QuranDatasetFixture) {
    this.chapterRows = dataset.chapters;
    this.verseById = new Map(dataset.verses.map((verse) => [verse.id, verse]));
    this.wordsByPage = new Map();
    for (const word of dataset.words) {
      const list = this.wordsByPage.get(word.pageNumber);
      if (list) {
        list.push(word);
      } else {
        this.wordsByPage.set(word.pageNumber, [word]);
      }
    }
  }

  async getChapters(): Promise<ProviderChapter[]> {
    return this.chapterRows.map((chapter) => ({
      id: chapter.id,
      nameArabic: chapter.nameArabic,
      nameSimple: chapter.nameSimple,
      nameTransliterated: chapter.nameTransliterated,
      translatedName: chapter.translatedName ?? undefined,
      versesCount: chapter.versesCount,
      revelationPlace: chapter.revelationPlace ?? undefined,
      bismillahPre: chapter.bismillahPre
    }));
  }

  // One ProviderVerse per DISTINCT verse id with >=1 word on this page,
  // words scoped to ONLY this page (a verse can straddle two pages) -
  // sync.ts accumulates a word's full record the first time it sees that
  // word.id via a Map, so under/over-scoping here would silently drop or
  // fabricate-duplicate words rather than error loudly.
  async getVersesByPage(pageNumber: number): Promise<ProviderVerse[]> {
    const wordsOnPage = this.wordsByPage.get(pageNumber) ?? [];
    const wordsByVerseId = new Map<number, FixtureWordRow[]>();
    for (const word of wordsOnPage) {
      const list = wordsByVerseId.get(word.verseId);
      if (list) {
        list.push(word);
      } else {
        wordsByVerseId.set(word.verseId, [word]);
      }
    }

    const verses: ProviderVerse[] = [];
    for (const [verseId, words] of wordsByVerseId) {
      const verse = this.verseById.get(verseId);
      if (!verse) {
        throw new Error(`Fixture word references unknown verse id ${verseId}`);
      }
      const providerWords: ProviderWord[] = words
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((word) => ({
          id: word.id,
          position: word.position,
          pageNumber: word.pageNumber,
          lineNumber: word.lineNumber ?? undefined,
          textUthmani: word.textUthmani,
          charTypeName: word.charTypeName,
          location: word.location ?? undefined,
          verseKey: word.verseKey
        }));
      verses.push({
        id: verse.id,
        verseKey: verse.verseKey,
        chapterId: verse.chapterId,
        verseNumber: verse.verseNumber,
        juzNumber: verse.juzNumber,
        pageNumber: verse.pageNumber,
        textUthmani: verse.textUthmani,
        textUthmaniSimple: verse.textUthmaniSimple ?? undefined,
        words: providerWords
      });
    }
    return verses;
  }
}

/**
 * The single word with the highest globalOrder in the whole dataset (the
 * final word of the final verse, 114:6). This specific choice matters:
 * syncQuranData recomputes every word's globalOrder from scratch each run
 * as a dense 1..N sequence over its own sorted payload, but a stale
 * (undeleted) row keeps whatever globalOrder value the LAST sync that
 * included it assigned. Removing any word that ISN'T the dataset's global
 * last one causes every word after it to shift down by one place in the
 * next sync's renumbering - which collides directly with the frozen
 * stale row's old value (proven empirically while writing this test; see
 * the task report for the concrete before/after numbers). Removing the
 * true last word is the one case where nothing shifts, so this is the
 * only choice for which the "stale row left behind" sync can itself
 * complete successfully.
 */
function pickGlobalLastWord(dataset: QuranDatasetFixture): FixtureWordRow {
  return dataset.words.reduce((max, word) =>
    word.globalOrder > max.globalOrder ? word : max
  );
}

async function tableCounts(pool: Pool) {
  const { rows } = await pool.query<{
    chapters: number;
    pages: number;
    verses: number;
    words: number;
  }>(`
    SELECT
      (SELECT COUNT(*)::int FROM "QuranChapter") AS chapters,
      (SELECT COUNT(*)::int FROM "QuranPage") AS pages,
      (SELECT COUNT(*)::int FROM "QuranVerse") AS verses,
      (SELECT COUNT(*)::int FROM "QuranWord") AS words
  `);
  return rows[0];
}

async function verseTextChecksum(pool: Pool) {
  const { rows } = await pool.query<{ checksum: string | null }>(
    `SELECT md5(string_agg("textUthmani", '' ORDER BY id)) AS checksum FROM "QuranVerse"`
  );
  return rows[0].checksum;
}

const run = connectionString ? describe : describe.skip;

run("syncQuranData end-to-end against a real Postgres", () => {
  const pool = new Pool({ connectionString });

  afterAll(async () => {
    // Restore the canonical baseline in case the last test to run left a
    // non-final sync state behind, then close the pool.
    await syncQuranData(new FixtureQuranProvider(fixture));
    await pool.end();
  });

  it(
    "syncs the full canonical dataset end-to-end, including findStaleRows at realistic 77k-word scale",
    { timeout: 120_000 },
    async () => {
      const provider = new FixtureQuranProvider(fixture);
      const result = await syncQuranData(provider);

      // This is the check that proves the `= ANY($1::int[])` fix in
      // findStaleRows (lib/quran/sync/sync.ts) doesn't regress back to
      // Prisma's `notIn: [...]`, which would blow past Postgres's
      // 65535-bind-parameter limit on the 77430 word ids and throw a real
      // Postgres error here rather than silently passing.
      expect(result).toEqual({
        ok: true,
        errors: [],
        counts: { chapters: 114, pages: 604, verses: 6236, words: 77430 }
      });

      const counts = await tableCounts(pool);
      expect(counts).toEqual({
        chapters: 114,
        pages: 604,
        verses: 6236,
        words: 77430
      });

      const syncRun = await pool.query<{ status: string }>(
        `SELECT status FROM "QuranSyncRun" ORDER BY "startedAt" DESC LIMIT 1`
      );
      expect(syncRun.rows[0].status).toBe("COMPLETED");
    }
  );

  it(
    "refuses the whole sync (no partial writes) when a previously-synced word is missing from the payload, and never deletes it",
    { timeout: 120_000 },
    async () => {
      // Independent baseline sync so this test doesn't depend on test 1
      // having already run (vitest runs `it`s within a file sequentially
      // by default, but this keeps the scenario self-contained either
      // way, and re-establishes a known-good starting point).
      await syncQuranData(new FixtureQuranProvider(fixture));

      const removedWord = pickGlobalLastWord(fixture);
      const before = await pool.query(
        `SELECT * FROM "QuranWord" WHERE id = $1`,
        [removedWord.id]
      );
      expect(before.rowCount).toBe(1);
      const countsBefore = await tableCounts(pool);

      // globalOrder is recomputed every sync as a dense 1..N sequence over
      // THIS payload (lib/quran/sync/sync.ts), but a stale row left behind
      // keeps whatever globalOrder its last real sync assigned - the two
      // are structurally incompatible, so sync.ts refuses up front rather
      // than proceeding into upserts that would very likely be rejected
      // downstream anyway (found empirically while first writing this
      // test - see git history for the original, since-fixed version of
      // this file). Removing pickGlobalLastWord specifically isn't
      // special-cased here anymore: refusal is unconditional on ANY
      // staleness now, not dependent on which id happens to shift least.
      const wordsWithoutRemoved = fixture.words.filter(
        (word) => word.id !== removedWord.id
      );
      const providerMissingOne = new FixtureQuranProvider({
        ...fixture,
        words: wordsWithoutRemoved
      });

      await expect(syncQuranData(providerMissingOne)).rejects.toThrow(
        /Sync refused.*not present in this sync's payload/s
      );

      // No partial writes: the refusal happens before any upsert runs, so
      // the whole table set - not just the removed word's own row - must
      // be byte-for-byte what it was before this attempt.
      const afterRemoved = await pool.query(
        `SELECT * FROM "QuranWord" WHERE id = $1`,
        [removedWord.id]
      );
      expect(afterRemoved.rowCount).toBe(1);
      expect(afterRemoved.rows[0]).toEqual(before.rows[0]);
      const countsAfter = await tableCounts(pool);
      expect(countsAfter).toEqual(countsBefore);

      const syncRun = await pool.query<{
        status: string;
        message: string | null;
      }>(
        `SELECT status, message FROM "QuranSyncRun" ORDER BY "startedAt" DESC LIMIT 1`
      );
      expect(syncRun.rows[0].status).toBe("FAILED");
      expect(syncRun.rows[0].message).toContain("Sync refused");
      expect(syncRun.rows[0].message).toContain(String(removedWord.id));

      // Restore the canonical baseline so later tests in this file (and
      // any other work reusing this container) see the real dataset
      // again, not a payload permanently missing one word.
      await syncQuranData(new FixtureQuranProvider(fixture));
      const restored = await tableCounts(pool);
      expect(restored.words).toBe(77430);
    }
  );

  it(
    "rolls back the entire sync when in-transaction validation fails, leaving prior data byte-for-byte untouched",
    { timeout: 120_000 },
    async () => {
      // Clean baseline first, so there is real data a bad sync could
      // corrupt, and so this test doesn't depend on test 1/2 ordering.
      await syncQuranData(new FixtureQuranProvider(fixture));

      const countsBefore = await tableCounts(pool);
      const checksumBefore = await verseTextChecksum(pool);

      // Mid-file verse (26:69), not the one used by the stale-row test -
      // its page has 126 words across many verses, so this edit can't
      // accidentally make it the page's dominant juz.
      const brokenVerseId = fixture.verses[3000].id;
      const brokenVerses = fixture.verses.map((verse) =>
        verse.id === brokenVerseId ? { ...verse, juzNumber: 99 } : verse
      );
      // preflightValidate (lib/quran/sync/sync.ts, runs before the
      // transaction) does not check juzNumber range at all, so this
      // payload passes preflight untouched and only fails inside the
      // transaction via validateQuranData's invalidJuz check - proving
      // the in-transaction validation path specifically, not just
      // preflight.
      const provider = new FixtureQuranProvider({
        ...fixture,
        verses: brokenVerses
      });

      await expect(syncQuranData(provider)).rejects.toThrow(/juz/i);

      const countsAfter = await tableCounts(pool);
      const checksumAfter = await verseTextChecksum(pool);
      expect(countsAfter).toEqual(countsBefore);
      expect(checksumAfter).toBe(checksumBefore);

      const syncRun = await pool.query<{
        status: string;
        message: string | null;
      }>(
        `SELECT status, message FROM "QuranSyncRun" ORDER BY "startedAt" DESC LIMIT 1`
      );
      expect(syncRun.rows[0].status).toBe("FAILED");
      expect(syncRun.rows[0].message ?? "").toMatch(/juz/i);
    }
  );
});
