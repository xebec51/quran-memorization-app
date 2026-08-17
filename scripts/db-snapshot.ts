import "../lib/env";
import { mkdirSync, writeFileSync } from "node:fs";
import { Pool } from "pg";

mkdirSync(new URL("../.migration-safety", import.meta.url), {
  recursive: true
});

const label = process.argv[2];
if (label !== "before" && label !== "after") {
  console.error(
    "usage: node --experimental-strip-types scripts/db-snapshot.ts before|after"
  );
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const tableCounts: Record<string, number> = {};
  for (const table of [
    "User",
    "Session",
    "AuthRateLimit",
    "MemorizationCycle",
    "MemorizationPackage",
    "MemorizationQuestion",
    "QuestionAssessment",
    "HintEvent",
    "EvaluationAttempt",
    "QuranChapter",
    "QuranPage",
    "QuranVerse",
    "QuranWord"
  ]) {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM "${table}"`
    );
    tableCounts[table] = rows[0].n;
  }

  // A single order-independent checksum per table that must be
  // byte-for-byte untouched by this migration - md5 of every row's
  // primary key + updatedAt (or createdAt where there's no updatedAt),
  // XORed together so row order never matters.
  async function unrelatedChecksum(table: string, hasUpdatedAt: boolean) {
    const col = hasUpdatedAt ? '"updatedAt"' : '"createdAt"';
    const { rows } = await pool.query(
      `SELECT md5(string_agg(md5(id || ${col}::text), '' ORDER BY id))::text AS checksum
       FROM "${table}"`
    );
    return rows[0].checksum;
  }

  const unrelatedChecksums: Record<string, string | null> = {
    User: await unrelatedChecksum("User", true),
    Session: await unrelatedChecksum("Session", false),
    AuthRateLimit: await unrelatedChecksum("AuthRateLimit", true),
    MemorizationCycle: await unrelatedChecksum("MemorizationCycle", true),
    MemorizationPackage: await unrelatedChecksum("MemorizationPackage", true),
    QuestionAssessment: await unrelatedChecksum("QuestionAssessment", false),
    HintEvent: await unrelatedChecksum("HintEvent", false),
    EvaluationAttempt: await unrelatedChecksum("EvaluationAttempt", false)
  };

  // MemorizationQuestion: everything EXCEPT the four reveal-progress
  // columns this migration is allowed to change must be byte-identical.
  const { rows: qRows } = await pool.query(
    `SELECT md5(string_agg(
       md5(
         id || "userId" || "cycleId" || "packageId" || "orderInPackage"::text ||
         state::text || "primaryPageNumber"::text || "juzNumber"::text ||
         "juzBand"::text || "surahId"::text || "anchorVerseId"::text ||
         "anchorVerseKey" || "pagePositionBucket"::text ||
         "fragmentStartWordId"::text || "initialWordCount"::text ||
         "visibleWordCount"::text || "visibleFragmentText" ||
         "maxExtensionCount"::text || "maxNextVerseCount"::text ||
         coalesce("answerRevealedAt"::text, '') || "createdAt"::text
       ),
       '' ORDER BY id
     ))::text AS checksum
     FROM "MemorizationQuestion"`
  );
  const memorizationQuestionUnrelatedChecksum = qRows[0].checksum;

  // The reveal-progress columns themselves, saved in full per-row so an
  // exact rollback is possible if verification ever fails.
  const { rows: revealRows } = await pool.query(
    `SELECT id, state, "answerRevealedAt", "revealBoundaryVerseId",
            "revealTotalAyahCount", "revealedAyahCount", "revealedVersesJson"
     FROM "MemorizationQuestion" ORDER BY id`
  );

  // Every assessed question's assessment value, keyed by questionId - the
  // single most important thing to prove untouched.
  const { rows: assessmentRows } = await pool.query(
    `SELECT "questionId", assessment FROM "QuestionAssessment" ORDER BY "questionId"`
  );

  const snapshot = {
    takenAt: new Date().toISOString(),
    label,
    tableCounts,
    unrelatedChecksums,
    memorizationQuestionUnrelatedChecksum,
    assessmentByQuestionId: Object.fromEntries(
      assessmentRows.map((r) => [r.questionId, r.assessment])
    ),
    revealColumnsByQuestionId: Object.fromEntries(
      revealRows.map((r) => [
        r.id,
        {
          state: r.state,
          answerRevealedAt: r.answerRevealedAt,
          revealBoundaryVerseId: r.revealBoundaryVerseId,
          revealTotalAyahCount: r.revealTotalAyahCount,
          revealedAyahCount: r.revealedAyahCount,
          revealedVersesJson: r.revealedVersesJson
        }
      ])
    )
  };

  writeFileSync(
    new URL(`../.migration-safety/snapshot-${label}.json`, import.meta.url),
    JSON.stringify(snapshot, null, 2)
  );
  console.log(`Snapshot "${label}" written. Table counts:`, tableCounts);
  console.log("Unrelated-table checksums:", unrelatedChecksums);
  console.log(
    "MemorizationQuestion unrelated-columns checksum:",
    memorizationQuestionUnrelatedChecksum
  );

  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
