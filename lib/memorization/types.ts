export type JuzBand = "A" | "B" | "C";
export type PagePositionBucket = "START" | "MIDDLE" | "END";
export type HintType = "JUZ" | "SURAH" | "EXTEND_FRAGMENT" | "NEXT_VERSE";
export type RecallAssessment = "CORRECT" | "PARTIAL" | "MISSED";

export type CyclePage = {
  pageNumber: number;
  juzBand: JuzBand;
};

export type CyclePlanQuestion = {
  pageNumber: number;
  juzBand: JuzBand;
  slot: "MANDATORY" | "WILDCARD";
};

export type CyclePlanPackage = {
  packageNumber: number;
  questions: CyclePlanQuestion[];
};

export type CyclePlan = {
  version: 1;
  seed: string;
  packagesPerCycle: number;
  questionsPerPackage: number;
  wildcardQuotas: Record<JuzBand, number>;
  packages: CyclePlanPackage[];
};

export type QuranWordRef = {
  id: number;
  verseId: number;
  verseKey: string;
  chapterId: number;
  verseNumber: number;
  juzNumber: number;
  pageNumber: number;
  position: number;
  globalOrder: number;
  lineNumber: number | null;
  textUthmani: string;
};

export type GeneratedQuestionSource = {
  primaryPageNumber: number;
  juzBand: JuzBand;
  juzNumber: number;
  surahId: number;
  anchorVerseId: number;
  anchorVerseKey: string;
  pagePositionBucket: PagePositionBucket;
  fragmentStartWordId: number;
  initialWordCount: number;
  visibleWordCount: number;
  fragmentText: string;
};

export type PublicQuestion = {
  id: string;
  order: number;
  totalQuestions: number;
  fragmentText: string;
  availableHints: {
    juz: boolean;
    surah: boolean;
    extendFragment: boolean;
    nextVerse: boolean;
  };
  answerRevealed: boolean;
  assessment: RecallAssessment | null;
};

export type PublicHint = {
  type: HintType;
  ordinal: number;
  text: string;
};

export type HintCounts = Record<HintType, number>;

export type HintMutationResult = {
  questionId: string;
  hint: PublicHint;
  availableHints: PublicQuestion["availableHints"];
  hintCounts: HintCounts;
  fragmentText?: string;
};

export type AssessmentMutationResult = {
  questionId: string;
  assessment: RecallAssessment;
  packageCompleted: boolean;
};
