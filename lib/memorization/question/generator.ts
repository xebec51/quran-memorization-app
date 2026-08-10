import type { RandomSource } from "../random";
import type { GeneratedQuestionSource, JuzBand, PagePositionBucket, QuranWordRef } from "../types";
import { bandForJuz } from "../cycle/constants";

const BUCKETS: PagePositionBucket[] = ["START", "MIDDLE", "END"];

export function generateQuestionSource(params: {
  primaryPageNumber: number;
  assignedBand: JuzBand;
  words: readonly QuranWordRef[];
  preferredBucket: PagePositionBucket;
  rng: RandomSource;
}): GeneratedQuestionSource {
  const pageWords = params.words
    .filter((word) => word.pageNumber === params.primaryPageNumber)
    .filter((word) => bandForJuz(word.juzNumber) === params.assignedBand)
    .sort((a, b) => a.globalOrder - b.globalOrder);

  if (pageWords.length < 4) {
    throw new Error(`Page ${params.primaryPageNumber} has insufficient words for a question`);
  }

  const candidates = candidatesForBucket(pageWords, params.preferredBucket);
  const usable = candidates.filter((candidate) => continuationInVerse(pageWords, candidate) >= 2);
  const anchor = (usable.length > 0 ? usable : candidates)[params.rng.int(0, (usable.length > 0 ? usable : candidates).length)];
  const sameVerseWords = pageWords
    .filter((word) => word.verseId === anchor.verseId && word.globalOrder >= anchor.globalOrder)
    .sort((a, b) => a.globalOrder - b.globalOrder);
  const maxInitial = Math.min(7, Math.max(2, sameVerseWords.length - 2));
  const minInitial = Math.min(4, maxInitial);
  const initialWordCount = params.rng.int(minInitial, maxInitial + 1);
  const fragmentWords = sameVerseWords.slice(0, initialWordCount);

  return {
    primaryPageNumber: params.primaryPageNumber,
    juzBand: params.assignedBand,
    juzNumber: anchor.juzNumber,
    surahId: anchor.chapterId,
    anchorVerseId: anchor.verseId,
    anchorVerseKey: anchor.verseKey,
    pagePositionBucket: params.preferredBucket,
    fragmentStartWordId: anchor.id,
    initialWordCount,
    visibleWordCount: initialWordCount,
    fragmentText: joinArabicWords(fragmentWords)
  };
}

export function nextBucket(index: number): PagePositionBucket {
  return BUCKETS[index % BUCKETS.length];
}

export function joinArabicWords(words: readonly { textUthmani: string }[]) {
  return words.map((word) => word.textUthmani).join(" ");
}

function candidatesForBucket(words: readonly QuranWordRef[], bucket: PagePositionBucket) {
  const start = Math.floor(words.length * (bucket === "START" ? 0 : bucket === "MIDDLE" ? 0.33 : 0.66));
  const end = Math.max(start + 1, Math.floor(words.length * (bucket === "START" ? 0.34 : bucket === "MIDDLE" ? 0.67 : 1)));
  return words.slice(start, end);
}

function continuationInVerse(words: readonly QuranWordRef[], anchor: QuranWordRef) {
  return words.filter((word) => word.verseId === anchor.verseId && word.globalOrder >= anchor.globalOrder).length;
}
