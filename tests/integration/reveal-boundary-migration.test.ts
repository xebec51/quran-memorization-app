import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

/**
 * Proves migration 20260818050000_fix_reveal_boundary_and_legacy_overclaim
 * is safe against a database that already has legacy-shaped data - not
 * just an empty schema. Requires a real Postgres with the full canonical
 * Quran dataset loaded (see README "Testing" / npm run quran:load-fixture)
 * via TEST_DATABASE_URL or DATABASE_URL; skips cleanly if neither is set
 * so this never blocks the DB-free unit suite.
 */
const connectionString =
  process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

const migrationSql = readFileSync(
  path.join(
    import.meta.dirname,
    "../../prisma/migrations/20260818050000_fix_reveal_boundary_and_legacy_overclaim/migration.sql"
  ),
  "utf8"
);

const run = connectionString ? describe : describe.skip;

run("reveal boundary corrective migration against legacy data", () => {
  const pool = new Pool({ connectionString });
  const runId = randomUUID().slice(0, 8);
  const userId = `test-user-${runId}`;
  const cycleId = `test-cycle-${runId}`;
  const packageId = `test-package-${runId}`;

  // Question ids, one per scenario this migration must handle correctly.
  const qLegacyOverclaimed = `test-q-legacy-${runId}`; // pre-migration "Lihat Jawaban" backfill over-claim, ASSESSED
  const qNewStylePartial = `test-q-partial-${runId}`; // genuine progressive reveal, partial, unassessed
  const qPage603 = `test-q-603-${runId}`; // boundary must land on page 604 (end of Quran)
  const qPage604 = `test-q-604-${runId}`; // boundary has no "next page" - must stay page 604
  const qAssessedModern = `test-q-modern-assessed-${runId}`; // already-ASSESSED, unrelated to the bug, must be left alone

  let anchorPage1: number;
  let anchorPage2: number;
  let anchorPage5: number;
  let anchorPage603: number;
  let anchorPage604: number;

  beforeAll(async () => {
    // Anchors: first verse whose primary content is on the given page,
    // picked directly from the real loaded Quran data (not fabricated).
    async function firstVerseIdOnPage(pageNumber: number) {
      const { rows } = await pool.query<{ id: number }>(
        `SELECT v.id FROM "QuranWord" w
         JOIN "QuranVerse" v ON v.id = w."verseId"
         WHERE w."pageNumber" = $1 AND w."charTypeName" = 'word'
         ORDER BY w."globalOrder" ASC LIMIT 1`,
        [pageNumber]
      );
      if (!rows[0])
        throw new Error(
          `No words found on page ${pageNumber} - fixture not loaded?`
        );
      return rows[0].id;
    }
    anchorPage1 = await firstVerseIdOnPage(1);
    anchorPage2 = await firstVerseIdOnPage(2);
    anchorPage5 = await firstVerseIdOnPage(5);
    anchorPage603 = await firstVerseIdOnPage(603);
    anchorPage604 = await firstVerseIdOnPage(604);

    await pool.query(
      `INSERT INTO "User" (id, email, "passwordHash", name, "createdAt", "updatedAt")
       VALUES ($1, $2, 'x', 'Migration Test User', now(), now())`,
      [userId, `${userId}@example.test`]
    );
    await pool.query(
      `INSERT INTO "MemorizationCycle" (id, "userId", "cycleNumber", seed, plan, "nextPackageNo", state, "createdAt", "updatedAt")
       VALUES ($1, $2, 1, 'seed', '{}'::jsonb, 2, 'ACTIVE', now(), now())`,
      [cycleId, userId]
    );
    await pool.query(
      `INSERT INTO "MemorizationPackage" (id, "userId", "cycleId", "packageNumber", state, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 1, 'IN_PROGRESS', now(), now())`,
      [packageId, userId, cycleId]
    );

    async function insertQuestion(params: {
      id: string;
      anchorVerseId: number;
      primaryPageNumber: number;
      order: number;
      state: "ACTIVE" | "ANSWER_REVEALED" | "ASSESSED";
      revealedAyahCount: number;
      // Old (buggy, same-page) boundary/total this row would have had
      // before the fix, to prove the migration actually changes it.
      oldRevealTotalAyahCount: number;
      answerRevealedAt: Date | null;
      createdAt: Date;
    }) {
      await pool.query(
        `INSERT INTO "MemorizationQuestion" (
           id, "userId", "cycleId", "packageId", "orderInPackage",
           "primaryPageNumber", "juzNumber", "juzBand", "surahId",
           "anchorVerseId", "anchorVerseKey", "pagePositionBucket",
           "fragmentStartWordId", "initialWordCount", "visibleWordCount",
           "visibleFragmentText", "maxExtensionCount", "maxNextVerseCount",
           "revealBoundaryVerseId", "revealTotalAyahCount", "revealedAyahCount",
           "revealedVersesJson", state, "answerRevealedAt", "createdAt", "updatedAt"
         )
         SELECT
           $1, $2, $3, $4, $5,
           $6, v."juzNumber", 'A', v."chapterId",
           v.id, v."verseKey", 'START',
           w.id, 3, 3,
           'fragmen uji', 3, 3,
           v.id, $7, $8,
           '[]'::jsonb, $9, $10, $11, $11
         FROM "QuranVerse" v
         JOIN "QuranWord" w ON w."verseId" = v.id AND w.position = 1
         WHERE v.id = $12
         LIMIT 1`,
        [
          params.id,
          userId,
          cycleId,
          packageId,
          params.order,
          params.primaryPageNumber,
          params.oldRevealTotalAyahCount,
          params.revealedAyahCount,
          params.state,
          params.answerRevealedAt,
          params.createdAt,
          params.anchorVerseId
        ]
      );
    }

    // (a) Legacy over-claim: created well before the old backfill
    // migration's timestamp, answer "revealed" under the single-shot
    // flow, and the old backfill marked it fully revealed
    // (revealedAyahCount === oldRevealTotalAyahCount) even though the old
    // feature only ever showed up to 3 ayat. ASSESSED, with a real
    // assessment row - must stay ASSESSED with that same assessment.
    await insertQuestion({
      id: qLegacyOverclaimed,
      anchorVerseId: anchorPage1,
      primaryPageNumber: 1,
      order: 1,
      state: "ASSESSED",
      revealedAyahCount: 7, // old (same-page) boundary total for page 1 is 1:7
      oldRevealTotalAyahCount: 7,
      answerRevealedAt: new Date("2026-08-11T00:00:00Z"),
      createdAt: new Date("2026-08-11T00:00:00Z")
    });
    await pool.query(
      `INSERT INTO "QuestionAssessment" (id, "userId", "questionId", assessment, "createdAt")
       VALUES ($1, $2, $3, 'CORRECT', $4)`,
      [
        `test-assess-${runId}`,
        userId,
        qLegacyOverclaimed,
        new Date("2026-08-11T00:05:00Z")
      ]
    );

    // (b) Genuine progressive reveal (created after the old backfill
    // migration ran), 2 ayat actually revealed via real clicks, not yet
    // assessed. Must be left with revealedAyahCount = 2 untouched - only
    // its total/boundary should grow.
    await insertQuestion({
      id: qNewStylePartial,
      anchorVerseId: anchorPage2,
      primaryPageNumber: 2,
      order: 2,
      state: "ANSWER_REVEALED",
      revealedAyahCount: 2,
      oldRevealTotalAyahCount: 5, // whatever the old (wrong) total happened to be
      answerRevealedAt: new Date("2026-08-18T00:00:00Z"),
      createdAt: new Date("2026-08-18T00:00:00Z")
    });

    // (c) Page 603: boundary must land on 604's last verse, i.e. the very
    // last verse of the Quran (114:6) - the exact worked example from the
    // spec.
    await insertQuestion({
      id: qPage603,
      anchorVerseId: anchorPage603,
      primaryPageNumber: 603,
      order: 3,
      state: "ACTIVE",
      revealedAyahCount: 0,
      oldRevealTotalAyahCount: 1,
      answerRevealedAt: null,
      createdAt: new Date("2026-08-18T00:00:00Z")
    });

    // (d) Page 604: has no "next page" - LEAST(604+1, 604) = 604, so the
    // boundary must stay on page 604 itself, unchanged.
    await insertQuestion({
      id: qPage604,
      anchorVerseId: anchorPage604,
      primaryPageNumber: 604,
      order: 4,
      state: "ACTIVE",
      revealedAyahCount: 0,
      oldRevealTotalAyahCount: 1,
      answerRevealedAt: null,
      createdAt: new Date("2026-08-18T00:00:00Z")
    });

    // (e) Already-ASSESSED, fully revealed under the NEW system (not a
    // legacy backfill row) - must be left completely alone in every
    // column except the boundary/total correction itself. Uses a
    // distinct page/order from every other fixture row in this same
    // cycle/package to satisfy the real unique constraints
    // (@@unique([cycleId, primaryPageNumber]), @@unique([packageId,
    // orderInPackage])).
    await insertQuestion({
      id: qAssessedModern,
      anchorVerseId: anchorPage5,
      primaryPageNumber: 5,
      order: 5,
      state: "ASSESSED",
      revealedAyahCount: 5,
      oldRevealTotalAyahCount: 5,
      answerRevealedAt: new Date("2026-08-18T01:00:00Z"),
      createdAt: new Date("2026-08-18T01:00:00Z")
    });
    await pool.query(
      `INSERT INTO "QuestionAssessment" (id, "userId", "questionId", assessment, "createdAt")
       VALUES ($1, $2, $3, 'PARTIAL', now())`,
      [`test-assess-modern-${runId}`, userId, qAssessedModern]
    );
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM "MemorizationQuestion" WHERE "userId" = $1`, [
      userId
    ]);
    await pool.query(`DELETE FROM "MemorizationPackage" WHERE "userId" = $1`, [
      userId
    ]);
    await pool.query(`DELETE FROM "MemorizationCycle" WHERE "userId" = $1`, [
      userId
    ]);
    await pool.query(`DELETE FROM "User" WHERE id = $1`, [userId]);
    await pool.end();
  });

  /**
   * Independently computed expected total (COUNT(*), not the migration's
   * own globalOrder-subtraction arithmetic) so this is a genuine
   * cross-check rather than restating the implementation.
   */
  async function expectedTotalForPage(
    anchorVerseId: number,
    primaryPageNumber: number
  ) {
    const boundaryPage = Math.min(primaryPageNumber + 1, 604);
    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n
       FROM "QuranVerse"
       WHERE "globalOrder" BETWEEN
         (SELECT "globalOrder" FROM "QuranVerse" WHERE id = $1)
         AND (
           SELECT v."globalOrder" FROM "QuranWord" w
           JOIN "QuranVerse" v ON v.id = w."verseId"
           WHERE w."pageNumber" = $2 AND w."charTypeName" = 'word'
           ORDER BY w."globalOrder" DESC LIMIT 1
         )`,
      [anchorVerseId, boundaryPage]
    );
    return rows[0].n;
  }

  it("preserves every row and never resets state/assessment while correcting boundaries", async () => {
    const before = await pool.query(
      `SELECT id, state, "revealedAyahCount", "revealTotalAyahCount" FROM "MemorizationQuestion" WHERE "userId" = $1 ORDER BY id`,
      [userId]
    );
    expect(before.rowCount).toBe(5);
    const userCountBefore = await pool.query(
      `SELECT count(*)::int AS n FROM "User"`
    );
    const assessmentCountBefore = await pool.query(
      `SELECT count(*)::int AS n FROM "QuestionAssessment" WHERE "userId" = $1`,
      [userId]
    );

    await pool.query(migrationSql);

    const userCountAfter = await pool.query(
      `SELECT count(*)::int AS n FROM "User"`
    );
    const assessmentCountAfter = await pool.query(
      `SELECT count(*)::int AS n FROM "QuestionAssessment" WHERE "userId" = $1`,
      [userId]
    );
    expect(userCountAfter.rows[0].n).toBe(userCountBefore.rows[0].n);
    expect(assessmentCountAfter.rows[0].n).toBe(
      assessmentCountBefore.rows[0].n
    );

    const after = await pool.query(
      `SELECT id, state, "revealedAyahCount", "revealTotalAyahCount",
              (SELECT "verseKey" FROM "QuranVerse" WHERE id = "revealBoundaryVerseId") AS "boundaryVerseKey"
       FROM "MemorizationQuestion" WHERE "userId" = $1`,
      [userId]
    );
    const byId = new Map(after.rows.map((row) => [row.id, row]));

    // (a) legacy over-claim: total corrected to the independently-computed
    // true value (was 7 under the old same-page bug), revealedAyahCount
    // capped at 3 (not equal to the new total), state and assessment
    // untouched.
    const legacy = byId.get(qLegacyOverclaimed);
    expect(legacy.revealTotalAyahCount).toBe(
      await expectedTotalForPage(anchorPage1, 1)
    );
    expect(legacy.revealTotalAyahCount).toBeGreaterThan(7);
    expect(legacy.revealedAyahCount).toBe(3);
    expect(legacy.state).toBe("ASSESSED");
    const legacyAssessment = await pool.query(
      `SELECT assessment FROM "QuestionAssessment" WHERE "questionId" = $1`,
      [qLegacyOverclaimed]
    );
    expect(legacyAssessment.rows[0].assessment).toBe("CORRECT");

    // (b) genuine partial reveal: revealedAyahCount untouched at 2, total
    // corrected to the independently-computed true value, still
    // unassessed.
    const partial = byId.get(qNewStylePartial);
    expect(partial.revealedAyahCount).toBe(2);
    expect(partial.revealTotalAyahCount).toBe(
      await expectedTotalForPage(anchorPage2, 2)
    );
    expect(partial.state).toBe("ANSWER_REVEALED");

    // (c) page 603 -> boundary is the true last verse of the Quran.
    const p603 = byId.get(qPage603);
    expect(p603.boundaryVerseKey).toBe("114:6");

    // (d) page 604 -> boundary stays on page 604 (no next page to extend
    // into); revealedAyahCount (0) is untouched.
    const p604 = byId.get(qPage604);
    expect(p604.revealedAyahCount).toBe(0);

    // (e) already-assessed, non-legacy row: revealedAyahCount and state
    // untouched, only total may have grown.
    const modern = byId.get(qAssessedModern);
    expect(modern.revealedAyahCount).toBe(5);
    expect(modern.state).toBe("ASSESSED");
    const modernAssessment = await pool.query(
      `SELECT assessment FROM "QuestionAssessment" WHERE "questionId" = $1`,
      [qAssessedModern]
    );
    expect(modernAssessment.rows[0].assessment).toBe("PARTIAL");
  });

  it("is idempotent - re-running it changes nothing further", async () => {
    const before = await pool.query(
      `SELECT id, "revealBoundaryVerseId", "revealTotalAyahCount", "revealedAyahCount", "revealedVersesJson"
       FROM "MemorizationQuestion" WHERE "userId" = $1 ORDER BY id`,
      [userId]
    );

    await pool.query(migrationSql);

    const after = await pool.query(
      `SELECT id, "revealBoundaryVerseId", "revealTotalAyahCount", "revealedAyahCount", "revealedVersesJson"
       FROM "MemorizationQuestion" WHERE "userId" = $1 ORDER BY id`,
      [userId]
    );
    expect(after.rows).toEqual(before.rows);
  });

  it("never violates the revealedAyahCount <= revealTotalAyahCount constraint", async () => {
    const violations = await pool.query(
      `SELECT count(*)::int AS n FROM "MemorizationQuestion"
       WHERE "userId" = $1 AND "revealedAyahCount" > "revealTotalAyahCount"`,
      [userId]
    );
    expect(violations.rows[0].n).toBe(0);
  });
});
