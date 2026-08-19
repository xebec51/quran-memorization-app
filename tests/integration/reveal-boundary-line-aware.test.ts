import { describe, expect, it } from "vitest";

/**
 * Proves computeRevealBoundary/computeRevealBoundariesBulk
 * (lib/memorization/reveal/service.ts) size the reveal boundary
 * proportionally to where the question's fragment starts on its own
 * page, instead of always claiming the entire next Mushaf page - see the
 * function doc comments for the full rationale. Requires a real Postgres
 * with the full canonical Quran dataset loaded (see README "Testing" /
 * npm run quran:load-fixture) via TEST_DATABASE_URL or DATABASE_URL;
 * skips cleanly if neither is set. See tests/integration/setup-env.ts for
 * how TEST_DATABASE_URL is safely swapped into lib/db/prisma.ts's
 * module-load-time DATABASE_URL read before this file's own imports
 * (which pull in the real `prisma` client) resolve.
 */
const connectionString =
  process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

const run = connectionString ? describe : describe.skip;

run("line-aware reveal boundary against real Quran data", () => {
  it("shrinks the boundary when the fragment starts near the top of its page (page 10 -> 11)", async () => {
    const { prisma } = await import("../../lib/db/prisma");
    const { computeRevealBoundary } =
      await import("../../lib/memorization/reveal/service");

    // 2:62 (verseId 69) is the first word of a verse starting at line 1
    // of page 10 - independently confirmed against the real dataset.
    const boundary = await computeRevealBoundary(prisma, 69, 10, 1);

    // Independently computed (not calling computeRevealBoundary again):
    // the true last verse of page 11 without any line restriction, i.e.
    // what the OLD "always claim the whole next page" rule would give.
    const unrestricted = await prisma.$queryRaw<
      { verseId: number; globalOrder: number }[]
    >`
      SELECT w."verseId", v."globalOrder"
      FROM "QuranWord" w
      JOIN "QuranVerse" v ON v.id = w."verseId"
      WHERE w."pageNumber" = 11 AND w."charTypeName" = 'word'
      ORDER BY w."globalOrder" DESC
      LIMIT 1
    `;
    const anchor = await prisma.quranVerse.findUniqueOrThrow({
      where: { id: 69 },
      select: { globalOrder: true }
    });
    const oldTotalAyahCount =
      unrestricted[0].globalOrder - anchor.globalOrder + 1;

    // Verified exact values against the real dataset: boundary lands on
    // 2:70 (9 ayat total) instead of the whole-page 2:76 (15 ayat total).
    expect(boundary.boundaryVerseId).toBe(77); // 2:70
    expect(boundary.totalAyahCount).toBe(9);
    expect(boundary.totalAyahCount).toBeLessThan(oldTotalAyahCount);
    expect(oldTotalAyahCount).toBe(15);
  });

  it("claims nearly the whole next page when the fragment starts near the bottom of its page", async () => {
    const { prisma } = await import("../../lib/db/prisma");
    const { computeRevealBoundary } =
      await import("../../lib/memorization/reveal/service");

    // 2:69 (verseId 76) is the first word of a verse starting at line 14
    // of page 10 (near the bottom) - independently confirmed.
    const boundary = await computeRevealBoundary(prisma, 76, 10, 14);

    // Same boundary page (11) as the previous test, so the whole-page
    // boundary is the same known value: 2:76, globalOrder 83.
    expect(boundary.boundaryVerseId).toBe(83); // 2:76 - the whole-page boundary
    expect(boundary.totalAyahCount).toBe(8); // 83 - 76 + 1
  });

  it("never cuts a verse mid-way - the boundary verse always lies fully on the boundary page", async () => {
    const { prisma } = await import("../../lib/db/prisma");
    const { computeRevealBoundary } =
      await import("../../lib/memorization/reveal/service");

    const boundary = await computeRevealBoundary(prisma, 69, 10, 1);
    const boundaryVersePages = await prisma.quranWord.findMany({
      where: { verseId: boundary.boundaryVerseId, charTypeName: "word" },
      select: { pageNumber: true },
      distinct: ["pageNumber"]
    });
    expect(boundaryVersePages).toHaveLength(1);
    expect(boundaryVersePages[0].pageNumber).toBe(11);
  });

  it("page 604 has no next page - the boundary claims the rest of page 604, unrestricted by line", async () => {
    const { prisma } = await import("../../lib/db/prisma");
    const { computeRevealBoundary } =
      await import("../../lib/memorization/reveal/service");

    // 112:1 (verseId 6222) starts at line 3 of page 604 - the last
    // Mushaf page. Passing that line must be ignored entirely, since
    // min(604 + 1, 604) collapses back onto page 604 itself.
    const boundary = await computeRevealBoundary(prisma, 6222, 604, 3);

    // 114:6 (verseId 6236, globalOrder 6236) is the true last verse of
    // the Quran - independently confirmed, and matches the same fact the
    // pre-existing reveal-boundary-migration integration test proves
    // against the historical corrective migration.
    expect(boundary.boundaryVerseId).toBe(6236);
  });

  it("computeRevealBoundariesBulk agrees with computeRevealBoundary called individually", async () => {
    const { prisma } = await import("../../lib/db/prisma");
    const { computeRevealBoundary, computeRevealBoundariesBulk } =
      await import("../../lib/memorization/reveal/service");

    const sources = [
      { anchorVerseId: 69, primaryPageNumber: 10, fragmentStartLineNumber: 1 },
      {
        anchorVerseId: 76,
        primaryPageNumber: 10,
        fragmentStartLineNumber: 14
      },
      {
        anchorVerseId: 6222,
        primaryPageNumber: 604,
        fragmentStartLineNumber: 3
      }
    ];

    const bulkResults = await computeRevealBoundariesBulk(prisma, sources);
    const individualResults = await Promise.all(
      sources.map((source) =>
        computeRevealBoundary(
          prisma,
          source.anchorVerseId,
          source.primaryPageNumber,
          source.fragmentStartLineNumber
        )
      )
    );

    expect(bulkResults).toEqual(individualResults);
  });
});
