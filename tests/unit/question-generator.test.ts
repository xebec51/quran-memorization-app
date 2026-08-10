import { describe, expect, it } from "vitest";
import { generateQuestionSource } from "@/lib/memorization/question/generator";
import { projectExtensionHint } from "@/lib/memorization/hint/service";
import { SeededRandomSource } from "@/lib/memorization/random";
import type { PagePositionBucket, QuranWordRef } from "@/lib/memorization/types";

const words = makeWords([
  { verseId: 10, verseKey: "fixture:1", wordCount: 12 },
  { verseId: 11, verseKey: "fixture:2", wordCount: 12 },
  { verseId: 12, verseKey: "fixture:3", wordCount: 12 }
]);

describe("question generator", () => {
  it("always starts the prompt at word position 1 of the anchor ayah", () => {
    const question = generateQuestionSource({
      primaryPageNumber: 1,
      assignedBand: "A",
      words,
      preferredBucket: "MIDDLE",
      rng: new SeededRandomSource("question")
    });
    const anchor = words.find((word) => word.id === question.fragmentStartWordId);

    expect(anchor?.position).toBe(1);
    expect(anchor?.verseId).toBe(question.anchorVerseId);
    expect(question.fragmentText.split(" ")[0]).toBe(anchor?.textUthmani);
  });

  it("never starts from a mid-ayah word across page-area buckets", () => {
    for (const bucket of ["START", "MIDDLE", "END"] satisfies PagePositionBucket[]) {
      for (let index = 0; index < 10; index += 1) {
        const question = generateQuestionSource({
          primaryPageNumber: 1,
          assignedBand: "A",
          words,
          preferredBucket: bucket,
          rng: new SeededRandomSource(`${bucket}-${index}`)
        });
        const anchor = words.find((word) => word.id === question.fragmentStartWordId);
        expect(anchor?.position).toBe(1);
      }
    }
  });

  it("keeps START/MIDDLE/END page-area diversity while anchoring at ayah starts", () => {
    const buckets = ["START", "MIDDLE", "END"] satisfies PagePositionBucket[];
    const selected = buckets.map((bucket) =>
      generateQuestionSource({
        primaryPageNumber: 1,
        assignedBand: "A",
        words,
        preferredBucket: bucket,
        rng: new SeededRandomSource(`area-${bucket}`)
      })
    );

    expect(selected.map((question) => question.pagePositionBucket)).toEqual(buckets);
    expect(new Set(selected.map((question) => question.anchorVerseId)).size).toBeGreaterThan(1);
  });

  it("keeps EXTEND_FRAGMENT as a contiguous continuation from the same ayah beginning", () => {
    const question = generateQuestionSource({
      primaryPageNumber: 1,
      assignedBand: "A",
      words,
      preferredBucket: "START",
      rng: new SeededRandomSource("extension")
    });
    const verseWords = words.filter((word) => word.verseId === question.anchorVerseId);
    const extended = verseWords.slice(0, question.initialWordCount + 2);

    expect(projectExtensionHint({ ordinal: 1, visibleWords: extended }).text).toBe(
      extended.map((word) => word.textUthmani).join(" ")
    );
    expect(extended.map((word) => word.position)).toEqual(
      Array.from({ length: extended.length }, (_, index) => index + 1)
    );
  });

  it("handles short ayat safely without combining unrelated text", () => {
    const shortWords = makeWords([{ verseId: 20, verseKey: "fixture:short", wordCount: 3 }]);
    const question = generateQuestionSource({
      primaryPageNumber: 1,
      assignedBand: "A",
      words: shortWords,
      preferredBucket: "START",
      rng: new SeededRandomSource("short")
    });

    expect(question.initialWordCount).toBeGreaterThanOrEqual(1);
    expect(question.initialWordCount).toBeLessThanOrEqual(3);
    expect(question.fragmentStartWordId).toBe(shortWords[0].id);
    expect(question.fragmentText.split(" ")).toEqual(shortWords.slice(0, question.initialWordCount).map((word) => word.textUthmani));
  });

  it("rejects pages with insufficient usable words", () => {
    expect(() =>
      generateQuestionSource({
        primaryPageNumber: 1,
        assignedBand: "A",
        words: [],
        preferredBucket: "START",
        rng: new SeededRandomSource("short")
      })
    ).toThrow(/insufficient/);
  });
});

function makeWords(verses: { verseId: number; verseKey: string; wordCount: number }[]): QuranWordRef[] {
  let id = 1;
  let globalOrder = 1;
  return verses.flatMap((verse, verseIndex) =>
    Array.from({ length: verse.wordCount }, (_, wordIndex) => ({
      id: id++,
      verseId: verse.verseId,
      verseKey: verse.verseKey,
      chapterId: 1,
      verseNumber: verseIndex + 1,
      juzNumber: 1,
      pageNumber: 1,
      position: wordIndex + 1,
      globalOrder: globalOrder++,
      lineNumber: Math.floor(wordIndex / 5) + 1,
      textUthmani: `v${verse.verseId}w${wordIndex + 1}`
    }))
  );
}
