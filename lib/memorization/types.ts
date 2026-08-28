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
  // The printed Mushaf line the fragment starts on, on primaryPageNumber -
  // see computeRevealBoundary in lib/memorization/reveal/service.ts, which
  // uses this to size the reveal boundary on the next page proportionally
  // instead of always claiming the entire next page.
  fragmentStartLineNumber: number | null;
  initialWordCount: number;
  visibleWordCount: number;
  fragmentText: string;
};

export type RevealedAyah = {
  verseKey: string;
  text: string;
  surah: string;
  juz: number;
  page: number;
};

export type RevealProgress = {
  revealedAyahCount: number;
  totalAyahCount: number;
  isComplete: boolean;
  verses: RevealedAyah[];
};

export type RevealMutationResult = RevealProgress & { questionId: string };

export type PublicHintLine = {
  type: HintType;
  text: string;
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
  hints: PublicHintLine[];
  reveal: RevealProgress;
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
  belCount: number;
  tuntunCount: number;
  packageCompleted: boolean;
};

export type EvaluationBankItem = {
  questionId: string;
  fragmentText: string;
  lastResult: RecallAssessment;
  lastAttemptAt: string | null;
};

export type EvaluationBankPage = {
  items: EvaluationBankItem[];
  nextCursor: string | null;
};

export type EvaluationSessionDto = RevealProgress & {
  questionId: string;
  fragmentText: string;
};

export type EvaluationAttemptDto = {
  id: string;
  questionId: string;
  result: RecallAssessment;
  belCount: number;
  tuntunCount: number;
  createdAt: string;
};

export type EvaluationHistoryItem = EvaluationAttemptDto & {
  fragmentText: string;
};

export type EvaluationHistoryPage = {
  items: EvaluationHistoryItem[];
  nextCursor: string | null;
};

export type EvaluationHistorySummary = {
  totalAttempts: number;
  totalBelCount: number;
  totalTuntunCount: number;
  resultCounts: Record<RecallAssessment, number>;
};

export type StqhnCompetitionBranch =
  "HIFZH_30_JUZ_INDEPENDENT" | "TAFSIR_ARABIC";

// Bank listing item, shown before a question is selected - no
// start_verse_key/end_verse_key/passage_range here (see AGENT.md "Hidden
// Metadata Rule"): those identify exactly which ayat to expect, so like
// every other bank/reveal surface in this app, only the short Arabic
// fragment teaser is shown pre-selection. status reflects this user's
// frozen main-cycle QuestionAssessment for this question, if any -
// unaffected by any later Evaluation Practice re-attempts, exactly like
// the main flow and Evaluation Bank.
export type StqhnBankItem = {
  stqhnQuestionId: string;
  questionCode: string;
  competitionBranch: StqhnCompetitionBranch;
  competitionDay: number;
  fragmentText: string;
  status: "NOT_ATTEMPTED" | "IN_PROGRESS" | RecallAssessment;
  lastAttemptAt: string | null;
};

export type StqhnBankPage = {
  items: StqhnBankItem[];
  nextCursor: string | null;
};

// Returned when starting/resuming an STQHN question - questionId here is
// the underlying MemorizationQuestion.id, the same id used to call the
// existing /api/memorization/reveal, /api/memorization/reveal-all, and
// /api/memorization/assessment endpoints unmodified. No hint UI in this
// first STQHN integration (not part of the request), even though the
// underlying MemorizationQuestion row is fully hint-capable like any
// other - /api/memorization/hint would work against it unmodified too.
export type StqhnQuestionDto = {
  questionId: string;
  stqhnQuestionId: string;
  fragmentText: string;
  reveal: RevealProgress;
  assessment: RecallAssessment | null;
};

// History item - only ever produced for an assessed question, so the
// video link (which would let a user watch the original answer) is safe
// to include here: it never reaches the client before the question was
// actually answered, matching the Hidden Metadata Rule as it applies to
// bank items above.
export type StqhnHistoryItem = {
  questionId: string;
  stqhnQuestionId: string;
  questionCode: string;
  competitionBranch: StqhnCompetitionBranch;
  competitionDay: number;
  passageRange: string;
  assessment: RecallAssessment;
  belCount: number;
  tuntunCount: number;
  fragmentText: string;
  revealedVerses: RevealedAyah[];
  sourceVideoUrl: string;
  assessedAt: string;
};

export type StqhnHistoryPage = {
  items: StqhnHistoryItem[];
  nextCursor: string | null;
};

export type StqhnSummary = {
  totalQuestions: number;
  attemptedCount: number;
  correctCount: number;
  missedCount: number;
};
