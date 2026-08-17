import "../lib/env";
import { readFileSync } from "node:fs";
import { prisma } from "../lib/db/prisma";

/**
 * Loads the committed Quran fixture (tests/fixtures/quran-dataset.json,
 * see export-quran-fixture.ts) into whatever database DATABASE_URL points
 * at. Used by CI to populate an isolated, ephemeral Postgres service
 * container before running e2e tests - never used against a real/shared
 * database (there is no upsert-vs-existing-data safety here on purpose;
 * this is for a fresh CI database only).
 */
async function main() {
  const fixturePath = new URL(
    "../tests/fixtures/quran-dataset.json",
    import.meta.url
  );
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
    chapters: unknown[];
    pages: unknown[];
    verses: unknown[];
    words: unknown[];
  };

  await prisma.quranChapter.createMany({ data: fixture.chapters as never[] });
  await prisma.quranPage.createMany({ data: fixture.pages as never[] });
  await prisma.quranVerse.createMany({ data: fixture.verses as never[] });
  for (let i = 0; i < fixture.words.length; i += 2000) {
    await prisma.quranWord.createMany({
      data: fixture.words.slice(i, i + 2000) as never[]
    });
  }

  process.stdout.write(
    `Loaded fixture: ${fixture.chapters.length} chapters, ${fixture.pages.length} pages, ${fixture.verses.length} verses, ${fixture.words.length} words.\n`
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
