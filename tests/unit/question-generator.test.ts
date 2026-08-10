import { describe, expect, it } from "vitest";
import { generateQuestionSource } from "@/lib/memorization/question/generator";
import { SeededRandomSource } from "@/lib/memorization/random";
import type { QuranWordRef } from "@/lib/memorization/types";

const words: QuranWordRef[] = Array.from({ length: 30 }, (_, index) => ({
  id: index + 1,
  verseId: index < 15 ? 10 : 11,
  verseKey: index < 15 ? "fixture:1" : "fixture:2",
  chapterId: 1,
  verseNumber: index < 15 ? 1 : 2,
  juzNumber: 1,
  pageNumber: 1,
  position: index + 1,
  globalOrder: index + 1,
  lineNumber: Math.floor(index / 5) + 1,
  textUthmani: `token${index + 1}`
}));

describe("question generator", () => {
  it("selects a varied page-position bucket and contiguous source words", () => {
    const question = generateQuestionSource({
      primaryPageNumber: 1,
      assignedBand: "A",
      words,
      preferredBucket: "MIDDLE",
      rng: new SeededRandomSource("question")
    });
    expect(question.pagePositionBucket).toBe("MIDDLE");
    expect(question.initialWordCount).toBeGreaterThanOrEqual(4);
    const fragment = question.fragmentText.split(" ");
    expect(fragment).toHaveLength(question.initialWordCount);
    const start = Number(fragment[0].replace("token", ""));
    expect(fragment).toEqual(Array.from({ length: fragment.length }, (_, index) => `token${start + index}`));
  });

  it("rejects pages with insufficient usable words", () => {
    expect(() =>
      generateQuestionSource({
        primaryPageNumber: 1,
        assignedBand: "A",
        words: words.slice(0, 3),
        preferredBucket: "START",
        rng: new SeededRandomSource("short")
      })
    ).toThrow(/insufficient/);
  });
});
