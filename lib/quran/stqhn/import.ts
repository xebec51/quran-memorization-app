import { prisma } from "@/lib/db/prisma";
import {
  initialWordRange,
  joinArabicWords
} from "@/lib/memorization/question/generator";
import { SeededRandomSource } from "@/lib/memorization/random";

/**
 * One record from stqhn2025_all_5_videos_hifzh_master_372_with_youtube_links.json
 * (the STQHN 2025 master question bank export) - the full shape as it
 * appears in the source file. `unknown`-typed at the JSON.parse boundary
 * and narrowed by parseStqhnRecords below, since the file is external
 * input, not something this codebase controls the shape of.
 */
export type StqhnSourceRecord = {
  video_id: string;
  competition_day: number;
  competition_branch: string;
  question_type: string;
  participant_display_no: number;
  question_no_for_participant: number;
  question_id: string;
  timestamp_start: string;
  timestamp_start_sec: number;
  // Genuinely absent for a real, systematic subset of the source export
  // (224 of 372 records - always these same three fields together: end
  // timestamps and the transcript cross-reference, never the fields that
  // actually drive import behavior). Optional here rather than defaulted
  // to a fake value, and correspondingly nullable on StqhnQuestion.
  timestamp_end?: string;
  timestamp_end_sec?: number;
  start_verse_key: string;
  end_verse_key: string;
  passage_range: string;
  start_word_index: number;
  starts_at_verse_beginning: boolean;
  confidence: string;
  archive_eligible: boolean;
  audio_review_needed: string;
  audit_note: string;
  source_transcript?: string;
  master_bank_id: string;
  source_youtube_url: string;
};

const KNOWN_BRANCHES = new Set(["HIFZH_30_JUZ_INDEPENDENT", "TAFSIR_ARABIC"]);

// Required for every record - these drive actual import/practice
// behavior (anchor resolution, idempotency, the video-link feature), so
// a gap here is a real data problem worth failing loudly over, unlike
// timestamp_end/timestamp_end_sec/source_transcript (see StqhnSourceRecord).
const REQUIRED_STRING_FIELDS: (keyof StqhnSourceRecord)[] = [
  "video_id",
  "competition_branch",
  "question_type",
  "question_id",
  "timestamp_start",
  "start_verse_key",
  "end_verse_key",
  "passage_range",
  "confidence",
  "audio_review_needed",
  "audit_note",
  "master_bank_id",
  "source_youtube_url"
];

// Required for every record like REQUIRED_STRING_FIELDS above, just
// numeric/boolean instead of string - these also drive real import
// behavior (idempotent upsert data, not just archival metadata), so a
// gap here should fail loudly during parsing rather than reach a NOT
// NULL column and surface as an opaque Prisma error mid-transaction.
const REQUIRED_NUMBER_FIELDS: (keyof StqhnSourceRecord)[] = [
  "competition_day",
  "participant_display_no",
  "question_no_for_participant",
  "timestamp_start_sec",
  "start_word_index"
];

/**
 * Validates the parsed JSON is shaped as expected before anything is
 * imported - the JSON file is external input (a hand-curated export, not
 * something this codebase generates), so it is validated at this
 * boundary rather than trusted, the same way API request bodies are
 * validated with Zod at the HTTP boundary elsewhere in this app.
 */
export function parseStqhnRecords(json: unknown): StqhnSourceRecord[] {
  if (!Array.isArray(json)) {
    throw new Error("STQHN source file must be a JSON array of records.");
  }
  return json.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`STQHN record at index ${index} is not an object.`);
    }
    const record = entry as Record<string, unknown>;
    for (const field of REQUIRED_STRING_FIELDS) {
      if (typeof record[field] !== "string" || record[field] === "") {
        throw new Error(
          `STQHN record at index ${index} (master_bank_id ${String(record.master_bank_id)}) is missing required string field "${field}".`
        );
      }
    }
    for (const field of REQUIRED_NUMBER_FIELDS) {
      if (typeof record[field] !== "number") {
        throw new Error(
          `STQHN record at index ${index} (master_bank_id ${String(record.master_bank_id)}) is missing required number field "${field}".`
        );
      }
    }
    if (typeof record.starts_at_verse_beginning !== "boolean") {
      throw new Error(
        `STQHN record at index ${index} (master_bank_id ${String(record.master_bank_id)}) is missing required boolean field "starts_at_verse_beginning".`
      );
    }
    if (!KNOWN_BRANCHES.has(record.competition_branch as string)) {
      throw new Error(
        `STQHN record ${String(record.master_bank_id)} has unknown competition_branch "${String(record.competition_branch)}" - expected one of ${[...KNOWN_BRANCHES].join(", ")}.`
      );
    }
    return record as unknown as StqhnSourceRecord;
  });
}

/** "" and undefined both mean "not recorded" for the lenient fields. */
function optionalString(value: string | undefined): string | null {
  return value ? value : null;
}

/** "" (the source's own placeholder for a missing number) and undefined
 * both mean "not recorded" for the lenient numeric fields. */
function optionalNumber(value: number | string | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

export type StqhnImportResult = {
  totalRecords: number;
  importedHifzhCount: number;
  skippedNonHifzhCount: number;
};

/**
 * Imports the STQHN 2025 master question bank into StqhnQuestion - the
 * global, shared bank content (not per-user; see the model's doc comment
 * in prisma/schema.prisma). Only question_type "HIFZH_PROMPT" records are
 * imported (both competition_branch values - HIFZH_30_JUZ_INDEPENDENT and
 * TAFSIR_ARABIC - carry HIFZH_PROMPT questions in the source file; any
 * Tafsir maqra question type is excluded here, not upstream, so this
 * function is the single place that enforces "372 hafalan questions
 * only" regardless of what the source file happens to contain).
 *
 * Idempotent: upserts by masterBankId, the source's own stable natural
 * key, so re-running against the same or an updated file never creates
 * duplicates - a record whose content changed (e.g. an audit correction)
 * updates the existing row in place instead.
 *
 * anchorVerseId is resolved from start_verse_key against the already-synced
 * QuranVerse table once, up front, for every record - not per row - and
 * the whole import runs in one transaction: either every record resolves
 * and imports, or nothing is written, rather than leaving a partial
 * import behind if one row's verse key turns out to be unsyncable.
 *
 * The bank-listing teaser (fragmentStartWordId/initialWordCount/
 * fragmentText) is computed here too, deterministically - seeded on the
 * record's own masterBankId via SeededRandomSource, the same
 * initialWordRange heuristic the main flow's generateQuestionSource uses
 * - so re-running the import reproduces byte-identical teaser text every
 * time (idempotent in content, not just in row count).
 */
export async function importStqhnQuestions(
  records: readonly StqhnSourceRecord[]
): Promise<StqhnImportResult> {
  const hifzhRecords = records.filter(
    (record) => record.question_type === "HIFZH_PROMPT"
  );
  const skippedNonHifzhCount = records.length - hifzhRecords.length;

  const verseKeys = [
    ...new Set(hifzhRecords.map((record) => record.start_verse_key))
  ];
  const verses = await prisma.quranVerse.findMany({
    where: { verseKey: { in: verseKeys } },
    select: { id: true, verseKey: true }
  });
  const anchorVerseIdByKey = new Map(
    verses.map((verse) => [verse.verseKey, verse.id])
  );

  const unresolved = hifzhRecords.filter(
    (record) => !anchorVerseIdByKey.has(record.start_verse_key)
  );
  if (unresolved.length > 0) {
    throw new Error(
      `${unresolved.length} STQHN record(s) have a start_verse_key that does not resolve to a synced QuranVerse (first: ${unresolved[0].master_bank_id} -> ${unresolved[0].start_verse_key}) - run "npm run quran:sync" first.`
    );
  }

  const anchorVerseIds = verses.map((verse) => verse.id);
  const words = await prisma.quranWord.findMany({
    where: { verseId: { in: anchorVerseIds }, charTypeName: "word" },
    select: { id: true, verseId: true, position: true, textUthmani: true },
    orderBy: [{ verseId: "asc" }, { position: "asc" }]
  });
  const wordsByVerseId = new Map<number, typeof words>();
  for (const word of words) {
    const list = wordsByVerseId.get(word.verseId);
    if (list) list.push(word);
    else wordsByVerseId.set(word.verseId, [word]);
  }

  await prisma.$transaction(
    async (tx) => {
      for (const record of hifzhRecords) {
        const anchorVerseId = anchorVerseIdByKey.get(record.start_verse_key)!;
        const verseWords = wordsByVerseId.get(anchorVerseId);
        if (!verseWords || verseWords.length === 0) {
          throw new Error(
            `No words found for anchor verse of ${record.master_bank_id} (${record.start_verse_key}) - Quran data integrity problem, not a user error.`
          );
        }
        const { minInitial, maxInitial } = initialWordRange(verseWords.length);
        const rng = new SeededRandomSource(record.master_bank_id);
        const initialWordCount = rng.int(minInitial, maxInitial + 1);
        const data = {
          questionId: record.question_id,
          videoId: record.video_id,
          competitionDay: record.competition_day,
          competitionBranch: record.competition_branch as
            "HIFZH_30_JUZ_INDEPENDENT" | "TAFSIR_ARABIC",
          questionType: record.question_type,
          participantDisplayNo: record.participant_display_no,
          questionNoForParticipant: record.question_no_for_participant,
          timestampStart: record.timestamp_start,
          timestampStartSec: record.timestamp_start_sec,
          timestampEnd: optionalString(record.timestamp_end),
          timestampEndSec: optionalNumber(record.timestamp_end_sec),
          startVerseKey: record.start_verse_key,
          endVerseKey: record.end_verse_key,
          passageRange: record.passage_range,
          startWordIndex: record.start_word_index,
          startsAtVerseBeginning: record.starts_at_verse_beginning,
          confidence: record.confidence,
          audioReviewNeeded: record.audio_review_needed === "YES",
          auditNote: record.audit_note,
          sourceTranscript: optionalString(record.source_transcript),
          sourceYoutubeUrl: record.source_youtube_url,
          anchorVerseId,
          fragmentStartWordId: verseWords[0].id,
          initialWordCount,
          fragmentText: joinArabicWords(verseWords.slice(0, initialWordCount))
        };
        await tx.stqhnQuestion.upsert({
          where: { masterBankId: record.master_bank_id },
          create: { masterBankId: record.master_bank_id, ...data },
          update: data,
          select: { id: true }
        });
      }
    },
    { timeout: 60_000 }
  );

  return {
    totalRecords: records.length,
    importedHifzhCount: hifzhRecords.length,
    skippedNonHifzhCount
  };
}
