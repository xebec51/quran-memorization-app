import "../lib/env";
import { writeFileSync } from "node:fs";
import { prisma } from "../lib/db/prisma";

/**
 * Exports the currently-synced Quran reference corpus (chapters, pages,
 * verses, words) to a JSON fixture for CI/isolated-DB e2e testing.
 *
 * This is NOT fabricated data: docs/quran-data-integrity.md and AGENT.md
 * require Quran text to always come from the official Quran Foundation
 * API via quran:sync. This script only re-serializes data that already
 * passed that pipeline (see scripts/sync-quran.ts) - it is a snapshot of
 * a real synced dataset, taken once, so CI never needs live QF
 * credentials or a live external API call to run e2e tests against a
 * structurally complete (604 pages / 6236 verses) database.
 */
async function main() {
  const [chapters, pages, verses, words] = await Promise.all([
    prisma.quranChapter.findMany({ orderBy: { id: "asc" } }),
    prisma.quranPage.findMany({ orderBy: { pageNumber: "asc" } }),
    prisma.quranVerse.findMany({ orderBy: { id: "asc" } }),
    prisma.quranWord.findMany({ orderBy: { id: "asc" } })
  ]);

  if (
    chapters.length !== 114 ||
    pages.length !== 604 ||
    verses.length !== 6236
  ) {
    throw new Error(
      `Refusing to export an incomplete corpus: ${chapters.length} chapters, ${pages.length} pages, ${verses.length} verses. Run quran:sync first.`
    );
  }

  const fixture = {
    exportedAt: new Date().toISOString(),
    source: "quran-foundation-content-api",
    counts: {
      chapters: chapters.length,
      pages: pages.length,
      verses: verses.length,
      words: words.length
    },
    chapters,
    pages,
    verses,
    words
  };

  const outPath = new URL(
    "../tests/fixtures/quran-dataset.json",
    import.meta.url
  );
  writeFileSync(outPath, JSON.stringify(fixture));
  process.stdout.write(
    `Wrote ${outPath.pathname.replace(/^\/([A-Za-z]:)/, "$1")}: ${chapters.length} chapters, ${pages.length} pages, ${verses.length} verses, ${words.length} words.\n`
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
