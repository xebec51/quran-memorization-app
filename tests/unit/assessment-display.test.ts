import { describe, expect, it } from "vitest";
import { formatAssessmentPerformance } from "@/lib/memorization/assessment";

describe("formatAssessmentPerformance", () => {
  it.each([
    [2, 1, "2 BEL • 1 TUNTUN"],
    [2, 0, "2 BEL"],
    [0, 1, "1 TUNTUN"],
    [0, 0, "Mulus"]
  ])("formats bel=%s and tuntun=%s", (bel, tuntun, expected) => {
    expect(formatAssessmentPerformance(bel, tuntun)).toBe(expected);
  });

  it("omits counters unavailable on legacy assessments", () => {
    expect(formatAssessmentPerformance(null, null)).toBeNull();
  });
});
