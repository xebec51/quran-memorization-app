import type { RandomSource } from "../random";
import type {
  GeneratedQuestionSource,
  JuzBand,
  PagePositionBucket,
  QuranWordRef
} from "../types";
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

  if (pageWords.length === 0) {
    throw new Error(
      `Page ${params.primaryPageNumber} has insufficient words for a question`
    );
  }

  const bucketWords = candidatesForBucket(pageWords, params.preferredBucket);
  const anchorCandidates = ayahStartCandidates({
    bucketWords,
    pageWords,
    allWords: params.words,
    assignedBand: params.assignedBand
  });
  const anchor = anchorCandidates[params.rng.int(0, anchorCandidates.length)];
  const sameVerseWords = params.words
    .filter((word) => word.verseId === anchor.verseId)
    .sort((a, b) => a.position - b.position || a.globalOrder - b.globalOrder);
  const { minInitial, maxInitial } = initialWordRange(sameVerseWords.length);
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
    fragmentStartLineNumber: anchor.lineNumber,
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

function candidatesForBucket(
  words: readonly QuranWordRef[],
  bucket: PagePositionBucket
) {
  const start = Math.floor(
    words.length * (bucket === "START" ? 0 : bucket === "MIDDLE" ? 0.33 : 0.66)
  );
  const end = Math.max(
    start + 1,
    Math.floor(
      words.length *
        (bucket === "START" ? 0.34 : bucket === "MIDDLE" ? 0.67 : 1)
    )
  );
  return words.slice(start, end);
}

function ayahStartCandidates(params: {
  bucketWords: readonly QuranWordRef[];
  pageWords: readonly QuranWordRef[];
  allWords: readonly QuranWordRef[];
  assignedBand: JuzBand;
}) {
  const startsByVerse = new Map<number, QuranWordRef>();
  for (const word of params.allWords) {
    if (word.position !== 1) continue;
    if (bandForJuz(word.juzNumber) !== params.assignedBand) continue;
    const existing = startsByVerse.get(word.verseId);
    if (!existing || word.globalOrder < existing.globalOrder)
      startsByVerse.set(word.verseId, word);
  }

  const bucketVerseIds = new Set(
    params.bucketWords.map((word) => word.verseId)
  );
  const pageVerseIds = new Set(params.pageWords.map((word) => word.verseId));
  const bucketStarts = [...bucketVerseIds].flatMap((verseId) => {
    const start = startsByVerse.get(verseId);
    return start ? [start] : [];
  });
  if (bucketStarts.length > 0) return bucketStarts;

  const pageStarts = [...pageVerseIds].flatMap((verseId) => {
    const start = startsByVerse.get(verseId);
    return start ? [start] : [];
  });
  if (pageStarts.length > 0)
    return nearestStartsToBucket(params.bucketWords, pageStarts);

  throw new Error("No ayah beginning is available for the selected page area");
}

function nearestStartsToBucket(
  bucketWords: readonly QuranWordRef[],
  starts: readonly QuranWordRef[]
) {
  const center =
    bucketWords.length === 0
      ? 0
      : (bucketWords[0].globalOrder +
          bucketWords[bucketWords.length - 1].globalOrder) /
        2;
  const ranked = [...starts].sort(
    (left, right) =>
      Math.abs(left.globalOrder - center) - Math.abs(right.globalOrder - center)
  );
  const bestDistance = Math.abs(ranked[0].globalOrder - center);
  return ranked.filter(
    (word) => Math.abs(word.globalOrder - center) === bestDistance
  );
}

export function initialWordRange(totalWords: number) {
  if (totalWords <= 0)
    throw new Error("Cannot generate a prompt from an empty ayah");
  if (totalWords >= 9) return { minInitial: 4, maxInitial: 7 };
  if (totalWords >= 6) return { minInitial: 4, maxInitial: totalWords - 2 };
  if (totalWords >= 4) return { minInitial: 2, maxInitial: totalWords - 1 };
  return { minInitial: 1, maxInitial: totalWords };
}
