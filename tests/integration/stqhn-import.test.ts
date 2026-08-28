import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Proves importStqhnQuestions (lib/quran/stqhn/import.ts) against the
 * real STQHN 2025 master bank file checked into this repo, and against
 * synthetic records for the one behavior the real file can never exercise
 * (Tafsir maqra filtering - the real export is already pre-filtered to
 * 372 hifzh-only questions). Requires a real Postgres with the full
 * canonical Quran dataset loaded (see README "Testing" /
 * npm run quran:load-fixture) via TEST_DATABASE_URL or DATABASE_URL;
 * skips cleanly if neither is set. See tests/integration/setup-env.ts for
 * how TEST_DATABASE_URL is safely swapped into lib/db/prisma.ts's
 * module-load-time DATABASE_URL read before this file's own imports
 * (which pull in the real `prisma` client via lib/quran/stqhn/import.ts)
 * resolve.
 */
const connectionString =
  process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

const SOURCE_FILE = path.join(
  process.cwd(),
  "STQHN 2025",
  "stqhn2025_all_5_videos_hifzh_master_372_with_youtube_links.json"
);

const run = connectionString ? describe : describe.skip;

run("STQHN 2025 import", () => {
  it("imports exactly 372 hifzh questions, split HIFZH_30_JUZ_INDEPENDENT/TAFSIR_ARABIC as the source data actually is", async () => {
    const { parseStqhnRecords, importStqhnQuestions } =
      await import("../../lib/quran/stqhn/import");
    const { prisma } = await import("../../lib/db/prisma");

    const raw = readFileSync(SOURCE_FILE, "utf8");
    const records = parseStqhnRecords(JSON.parse(raw));
    const result = await importStqhnQuestions(records);

    expect(result.totalRecords).toBe(372);
    expect(result.importedHifzhCount).toBe(372);
    expect(result.skippedNonHifzhCount).toBe(0);

    const total = await prisma.stqhnQuestion.count();
    expect(total).toBe(372);

    const branchCounts = await prisma.stqhnQuestion.groupBy({
      by: ["competitionBranch"],
      _count: { _all: true }
    });
    const byBranch = Object.fromEntries(
      branchCounts.map((row) => [row.competitionBranch, row._count._all])
    );
    // Verified directly against the source JSON - both branches carry
    // question_type HIFZH_PROMPT questions and both are imported, per
    // the explicit "distinguish but don't exclude either branch"
    // requirement (only question_type would ever exclude a record, and
    // this source file has none that aren't HIFZH_PROMPT).
    expect(byBranch.HIFZH_30_JUZ_INDEPENDENT).toBe(220);
    expect(byBranch.TAFSIR_ARABIC).toBe(152);

    // The competition's own "paket" grouping - (videoId, competitionBranch,
    // participantDisplayNo) - partitions all 372 records into exactly 93
    // packages of exactly 4 questions each (verified directly against the
    // source JSON; see prisma/schema.prisma's StqhnPackage doc comment for
    // why competitionBranch must be part of the key).
    const packageTotal = await prisma.stqhnPackage.count();
    expect(packageTotal).toBe(93);
    const packageSizes = await prisma.stqhnQuestion.groupBy({
      by: ["stqhnPackageId"],
      _count: { _all: true }
    });
    expect(packageSizes).toHaveLength(93);
    expect(packageSizes.every((row) => row._count._all === 4)).toBe(true);
  });

  it("is idempotent - re-running against the same file changes nothing further", async () => {
    const { parseStqhnRecords, importStqhnQuestions } =
      await import("../../lib/quran/stqhn/import");
    const { prisma } = await import("../../lib/db/prisma");

    const raw = readFileSync(SOURCE_FILE, "utf8");
    const records = parseStqhnRecords(JSON.parse(raw));

    const before = await prisma.stqhnQuestion.findMany({
      orderBy: { questionId: "asc" },
      select: {
        masterBankId: true,
        questionId: true,
        anchorVerseId: true,
        fragmentText: true,
        initialWordCount: true
      }
    });

    await importStqhnQuestions(records);

    const after = await prisma.stqhnQuestion.findMany({
      orderBy: { questionId: "asc" },
      select: {
        masterBankId: true,
        questionId: true,
        anchorVerseId: true,
        fragmentText: true,
        initialWordCount: true
      }
    });

    // Not just the same count - the same rows with byte-identical
    // deterministic teaser text (see importStqhnQuestions's doc comment
    // on SeededRandomSource), proving idempotent in content too.
    expect(after).toEqual(before);
    expect(after).toHaveLength(372);
  });

  it("only imports question_type HIFZH_PROMPT records, excluding any Tafsir maqra question type", async () => {
    // Synthetic records: the real 372-record file has already been
    // pre-filtered upstream and contains zero non-HIFZH_PROMPT rows, so
    // this is the only way to exercise importStqhnQuestions' own
    // filtering rather than merely observing an upstream fact.
    const { importStqhnQuestions } =
      await import("../../lib/quran/stqhn/import");
    const { prisma } = await import("../../lib/db/prisma");

    const anchor = await prisma.quranVerse.findFirstOrThrow({
      select: { verseKey: true }
    });
    const runId = Math.random().toString(36).slice(2);
    const base = {
      video_id: `synthetic-${runId}`,
      competition_day: 1,
      competition_branch: "TAFSIR_ARABIC",
      participant_display_no: 1,
      question_no_for_participant: 1,
      timestamp_start: "00:00:00",
      timestamp_start_sec: 0,
      start_verse_key: anchor.verseKey,
      end_verse_key: anchor.verseKey,
      passage_range: anchor.verseKey,
      start_word_index: 0,
      starts_at_verse_beginning: true,
      confidence: "HIGH",
      archive_eligible: true,
      audio_review_needed: "NO",
      audit_note: "synthetic test fixture",
      source_youtube_url: "https://www.youtube.com/watch?v=synthetic"
    };

    const result = await importStqhnQuestions([
      {
        ...base,
        question_type: "HIFZH_PROMPT",
        question_id: `SYN-${runId}-HIFZH`,
        master_bank_id: `SYNTHETIC-${runId}-HIFZH`
      },
      {
        ...base,
        question_type: "TAFSIR_MAQRA",
        question_id: `SYN-${runId}-TAFSIR`,
        master_bank_id: `SYNTHETIC-${runId}-TAFSIR`
      }
    ]);

    expect(result.totalRecords).toBe(2);
    expect(result.importedHifzhCount).toBe(1);
    expect(result.skippedNonHifzhCount).toBe(1);

    const imported = await prisma.stqhnQuestion.findUnique({
      where: { masterBankId: `SYNTHETIC-${runId}-HIFZH` }
    });
    expect(imported).not.toBeNull();
    const excluded = await prisma.stqhnQuestion.findUnique({
      where: { masterBankId: `SYNTHETIC-${runId}-TAFSIR` }
    });
    expect(excluded).toBeNull();

    // Clean up both the question and the StqhnPackage importStqhnQuestions
    // created for it (onDelete: Restrict means the package must go after
    // its last question, not before - leaving it would orphan a
    // zero-question package that skews packageTotal in the test above on
    // a re-run).
    const importedPackageId = imported!.stqhnPackageId;
    await prisma.stqhnQuestion.delete({
      where: { masterBankId: `SYNTHETIC-${runId}-HIFZH` }
    });
    await prisma.stqhnPackage.delete({ where: { id: importedPackageId } });
  });
});
