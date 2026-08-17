import { prisma } from "@/lib/db/prisma";

export type QuestionAnchorViolation = {
  questionId: string;
  primaryPageNumber: number;
  anchorVerseKey: string;
  reason: string;
};

export type QuestionAnchorValidationResult = {
  totalQuestions: number;
  violations: QuestionAnchorViolation[];
};

/**
 * Referential existence (anchorVerseId/fragmentStartWordId/
 * revealBoundaryVerseId pointing at a real row) and per-cycle anchor
 * uniqueness are enforced by database foreign keys/a unique index
 * (see prisma/migrations/20260817073000_add_anchor_integrity_constraints)
 * and can never be violated by new writes. What that migration can't
 * express is checked here: that fragmentStartWordId is genuinely the
 * FIRST word of its verse - the "prompt always starts at an ayah
 * beginning" invariant documented in docs/memorization-engine.md and
 * enforced by lib/memorization/question/generator.ts's ayahStartCandidates
 * for every question generated from here on.
 *
 * This is a reporting tool, not a release gate: some historical rows
 * (created before this rule was enforced) fail it and are intentionally
 * left as-is rather than rewritten, since real users already answered
 * them - see scripts/validate-question-anchors.ts.
 */
export async function validateQuestionAnchors(): Promise<QuestionAnchorValidationResult> {
  const rows = await prisma.$queryRaw<
    {
      questionId: string;
      primaryPageNumber: number;
      anchorVerseKey: string;
      position: number;
    }[]
  >`
    SELECT q.id AS "questionId", q."primaryPageNumber", q."anchorVerseKey", w.position
    FROM "MemorizationQuestion" q
    JOIN "QuranWord" w ON w.id = q."fragmentStartWordId"
    WHERE w.position != 1
    ORDER BY q."createdAt" ASC
  `;
  const totalQuestions = await prisma.memorizationQuestion.count();
  return {
    totalQuestions,
    violations: rows.map((row) => ({
      questionId: row.questionId,
      primaryPageNumber: row.primaryPageNumber,
      anchorVerseKey: row.anchorVerseKey,
      reason: `fragmentStartWordId is at word position ${row.position}, not the start of the ayah`
    }))
  };
}
