import type { RecallAssessment } from "./types";

/**
 * Objective MHQ-style self-assessment: the user reports how many bel (bell
 * rings for a mistake) and tuntun (prompts needed) occurred, rather than
 * picking a subjective Benar/Sebagian benar/Belum ingat label. The stored
 * `assessment`/`result` enum is derived, not chosen - zero of both means a
 * clean pass (CORRECT); any bel or tuntun means the question needs further
 * practice (MISSED). PARTIAL is never produced by a new submission (main
 * cycle or evaluation practice) and remains a valid value only on
 * historical rows created before this change.
 *
 * Shared by both lib/memorization/service.ts (main-cycle submitAssessment)
 * and lib/memorization/evaluation/service.ts (submitEvaluationAttempt) so
 * the two derivations can never diverge.
 */
export function deriveAssessment(
  belCount: number,
  tuntunCount: number
): RecallAssessment {
  return belCount === 0 && tuntunCount === 0 ? "CORRECT" : "MISSED";
}

/** Compact result copy shared by every history view. */
export function formatAssessmentPerformance(
  belCount: number | null,
  tuntunCount: number | null
): string | null {
  // Old assessments created before the counters existed cannot be described
  // truthfully, so callers should omit the performance label for those rows.
  if (belCount === null && tuntunCount === null) return null;

  const bel = belCount ?? 0;
  const tuntun = tuntunCount ?? 0;
  if (bel > 0 && tuntun > 0) return `${bel} BEL • ${tuntun} TUNTUN`;
  if (bel > 0) return `${bel} BEL`;
  if (tuntun > 0) return `${tuntun} TUNTUN`;
  return "Mulus";
}
