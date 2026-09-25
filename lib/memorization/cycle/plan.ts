import { productConfig } from "@/lib/config";
import type { RandomSource } from "../random";
import type {
  CyclePage,
  CyclePlan,
  CyclePlanPackage,
  CyclePlanQuestion,
  JuzBand,
  MemorizationScope
} from "../types";
import { ALL_BANDS } from "./constants";

const QUESTIONS_PER_PACKAGE = productConfig.questionsPerPackage;

export const MEMORIZATION_SCOPE_OPTIONS = [
  {
    value: "THIRTY_JUZ",
    label: "30 Juz",
    description: "4 soal: Juz 1-10, 11-20, 21-30, dan wildcard"
  },
  {
    value: "TWENTY_JUZ",
    label: "20 Juz",
    description: "4 soal: 2 dari Juz 1-10 dan 2 dari Juz 11-20"
  },
  {
    value: "TEN_JUZ",
    label: "10 Juz",
    description: "4 soal dari empat kuartal Juz 1-10"
  }
] as const satisfies readonly {
  value: MemorizationScope;
  label: string;
  description: string;
}[];

export function scopeLabel(scope: MemorizationScope) {
  return (
    MEMORIZATION_SCOPE_OPTIONS.find((option) => option.value === scope)
      ?.label ?? "30 Juz"
  );
}

export function targetPageCountForScope(
  pages: readonly CyclePage[],
  scope: MemorizationScope
) {
  return pages.filter((page) => pageBelongsToScope(page, scope)).length;
}

export function calculateWildcardQuotas(
  pages: readonly CyclePage[],
  packagesPerCycle = productConfig.packagesPerCycle
) {
  const counts = countPagesByBand(pages);
  const quotas = Object.fromEntries(
    ALL_BANDS.map((band) => [band, counts[band] - packagesPerCycle])
  ) as Record<JuzBand, number>;

  for (const band of ALL_BANDS) {
    if (quotas[band] < 0) {
      throw new Error(
        `Juz band ${band} has ${counts[band]} pages, below the ${packagesPerCycle} mandatory requirement`
      );
    }
  }

  const wildcardTotal = ALL_BANDS.reduce((sum, band) => sum + quotas[band], 0);
  if (wildcardTotal !== packagesPerCycle) {
    throw new Error(
      `Wildcard quota mismatch: expected ${packagesPerCycle}, got ${wildcardTotal}`
    );
  }

  return quotas;
}

export function createCyclePlan(
  pages: readonly CyclePage[],
  seed: string,
  rng: RandomSource,
  scope: MemorizationScope = "THIRTY_JUZ"
): CyclePlan {
  validatePageSet(pages);
  if (scope === "TWENTY_JUZ") return createTwentyJuzPlan(pages, seed, rng);
  if (scope === "TEN_JUZ") return createTenJuzPlan(pages, seed, rng);
  return createThirtyJuzPlan(pages, seed, rng);
}

function createThirtyJuzPlan(
  pages: readonly CyclePage[],
  seed: string,
  rng: RandomSource
): CyclePlan {
  const wildcardQuotas = calculateWildcardQuotas(
    pages,
    productConfig.packagesPerCycle
  );
  const shuffledByBand = Object.fromEntries(
    ALL_BANDS.map((band) => [
      band,
      rng.shuffle(pages.filter((page) => page.juzBand === band))
    ])
  ) as Record<JuzBand, CyclePage[]>;

  const mandatoryDecks = Object.fromEntries(
    ALL_BANDS.map((band) => [
      band,
      shuffledByBand[band].slice(0, productConfig.packagesPerCycle)
    ])
  ) as Record<JuzBand, CyclePage[]>;

  const wildcardPools = Object.fromEntries(
    ALL_BANDS.map((band) => [
      band,
      shuffledByBand[band].slice(productConfig.packagesPerCycle)
    ])
  ) as Record<JuzBand, CyclePage[]>;

  const wildcardBandDeck = rng.shuffle(
    ALL_BANDS.flatMap((band) =>
      Array.from({ length: wildcardQuotas[band] }, () => band)
    )
  );

  const packages = Array.from(
    { length: productConfig.packagesPerCycle },
    (_, packageIndex) => {
      const mandatoryQuestions: CyclePlanQuestion[] = ALL_BANDS.map((band) => {
        const page = mandatoryDecks[band][packageIndex];
        return {
          pageNumber: page.pageNumber,
          juzBand: band,
          slot: "MANDATORY"
        };
      });
      const wildcardBand = wildcardBandDeck[packageIndex];
      const wildcardPage = wildcardPools[wildcardBand].shift();
      if (!wildcardPage) {
        throw new Error(`Wildcard pool exhausted for band ${wildcardBand}`);
      }
      return {
        packageNumber: packageIndex + 1,
        questions: rng.shuffle([
          ...mandatoryQuestions,
          {
            pageNumber: wildcardPage.pageNumber,
            juzBand: wildcardBand,
            slot: "WILDCARD" as const
          }
        ])
      };
    }
  );

  const consumedPages = packages.flatMap((pkg) =>
    pkg.questions.map((question) => question.pageNumber)
  );
  const uniquePages = new Set(consumedPages);
  if (
    consumedPages.length !== productConfig.mushafPages ||
    uniquePages.size !== productConfig.mushafPages
  ) {
    throw new Error("Cycle plan failed the 604 unique page invariant");
  }

  return {
    version: 2,
    seed,
    scope: "THIRTY_JUZ",
    packagesPerCycle: productConfig.packagesPerCycle,
    questionsPerPackage: QUESTIONS_PER_PACKAGE,
    targetPageCount: productConfig.mushafPages,
    wildcardQuotas,
    packages
  };
}

function createTwentyJuzPlan(
  pages: readonly CyclePage[],
  seed: string,
  rng: RandomSource
): CyclePlan {
  const decks = {
    A: rng.shuffle(pages.filter((page) => page.juzBand === "A")),
    B: rng.shuffle(pages.filter((page) => page.juzBand === "B"))
  };
  const packages: CyclePlanPackage[] = [];

  while (decks.A.length + decks.B.length > 0) {
    const fullPackage = decks.A.length >= 2 && decks.B.length >= 2;
    const questions = fullPackage
      ? [
          ...takeFromDeck(decks.A, 2, "MANDATORY", "JUZ_1_10"),
          ...takeFromDeck(decks.B, 2, "MANDATORY", "JUZ_11_20")
        ]
      : [
          ...takeFromDeck(decks.A, decks.A.length, "REMAINDER", "JUZ_1_10"),
          ...takeFromDeck(decks.B, decks.B.length, "REMAINDER", "JUZ_11_20")
        ];
    packages.push({
      packageNumber: packages.length + 1,
      questions: rng.shuffle(questions)
    });
  }

  return {
    version: 2,
    seed,
    scope: "TWENTY_JUZ",
    packagesPerCycle: packages.length,
    questionsPerPackage: QUESTIONS_PER_PACKAGE,
    targetPageCount: targetPageCountForScope(pages, "TWENTY_JUZ"),
    wildcardQuotas: emptyWildcardQuotas(),
    packages
  };
}

function createTenJuzPlan(
  pages: readonly CyclePage[],
  seed: string,
  rng: RandomSource
): CyclePlan {
  const selectedPages = pages
    .filter((page) => page.juzBand === "A")
    .sort((left, right) => left.pageNumber - right.pageNumber);
  const quarterDecks = splitIntoQuarters(selectedPages).map((quarter) =>
    rng.shuffle(quarter)
  );
  const packages: CyclePlanPackage[] = [];

  while (quarterDecks.some((deck) => deck.length > 0)) {
    const fullPackage = quarterDecks.every((deck) => deck.length > 0);
    const questions = fullPackage
      ? quarterDecks.flatMap((deck, index) =>
          takeFromDeck(deck, 1, "QUARTER", `Q${index + 1}`)
        )
      : quarterDecks.flatMap((deck, index) =>
          takeFromDeck(deck, deck.length, "REMAINDER", `Q${index + 1}`)
        );
    packages.push({
      packageNumber: packages.length + 1,
      questions: rng.shuffle(questions)
    });
  }

  return {
    version: 2,
    seed,
    scope: "TEN_JUZ",
    packagesPerCycle: packages.length,
    questionsPerPackage: QUESTIONS_PER_PACKAGE,
    targetPageCount: selectedPages.length,
    wildcardQuotas: emptyWildcardQuotas(),
    packages
  };
}

export function validateCyclePlan(plan: CyclePlan) {
  if (plan.packages.length !== plan.packagesPerCycle) {
    throw new Error(
      `Expected ${plan.packagesPerCycle} packages, found ${plan.packages.length}`
    );
  }

  const seenPages = new Set<number>();
  for (const [index, pkg] of plan.packages.entries()) {
    const isFinalPackage = index === plan.packages.length - 1;
    if (
      pkg.questions.length > plan.questionsPerPackage ||
      pkg.questions.length < 1 ||
      (!isFinalPackage && pkg.questions.length !== plan.questionsPerPackage)
    ) {
      throw new Error(
        `Package ${pkg.packageNumber} has invalid question count ${pkg.questions.length}`
      );
    }
    validatePackageDistribution(plan, pkg, isFinalPackage);
    for (const question of pkg.questions) {
      if (seenPages.has(question.pageNumber)) {
        throw new Error(
          `Primary page ${question.pageNumber} repeats inside the cycle`
        );
      }
      seenPages.add(question.pageNumber);
    }
  }

  if (seenPages.size !== plan.targetPageCount) {
    throw new Error(
      `Expected ${plan.targetPageCount} unique primary pages, found ${seenPages.size}`
    );
  }

  const wildcardCounts = Object.fromEntries(
    ALL_BANDS.map((band) => [band, 0])
  ) as Record<JuzBand, number>;
  for (const question of plan.packages.flatMap((pkg) => pkg.questions)) {
    if (question.slot === "WILDCARD") wildcardCounts[question.juzBand] += 1;
  }
  for (const band of ALL_BANDS) {
    if (wildcardCounts[band] !== plan.wildcardQuotas[band]) {
      throw new Error(`Wildcard quota mismatch for band ${band}`);
    }
  }
}

function validatePageSet(pages: readonly CyclePage[]) {
  if (pages.length !== productConfig.mushafPages) {
    throw new Error(`Expected 604 Mushaf pages, found ${pages.length}`);
  }
  const pageNumbers = new Set(pages.map((page) => page.pageNumber));
  if (pageNumbers.size !== productConfig.mushafPages) {
    throw new Error("Mushaf page list contains duplicate page numbers");
  }
  for (let page = 1; page <= productConfig.mushafPages; page += 1) {
    if (!pageNumbers.has(page)) throw new Error(`Missing Mushaf page ${page}`);
  }
}

function validatePackageDistribution(
  plan: CyclePlan,
  pkg: CyclePlanPackage,
  isFinalPackage: boolean
) {
  if (isFinalPackage && pkg.questions.length < plan.questionsPerPackage) return;
  if (plan.scope === "THIRTY_JUZ") {
    for (const band of ALL_BANDS) {
      if (!pkg.questions.some((question) => question.juzBand === band)) {
        throw new Error(`Package ${pkg.packageNumber} is missing band ${band}`);
      }
    }
    return;
  }
  if (plan.scope === "TWENTY_JUZ") {
    const counts = countQuestionsByBand(pkg.questions);
    if (counts.A !== 2 || counts.B !== 2 || counts.C !== 0) {
      throw new Error(
        `Package ${pkg.packageNumber} does not match 20-juz 2/2 distribution`
      );
    }
    return;
  }
  const segments = new Set(pkg.questions.map((question) => question.segment));
  for (const segment of ["Q1", "Q2", "Q3", "Q4"]) {
    if (!segments.has(segment)) {
      throw new Error(
        `Package ${pkg.packageNumber} is missing 10-juz segment ${segment}`
      );
    }
  }
}

function countPagesByBand(pages: readonly CyclePage[]) {
  return Object.fromEntries(
    ALL_BANDS.map((band) => [
      band,
      pages.filter((page) => page.juzBand === band).length
    ])
  ) as Record<JuzBand, number>;
}

function countQuestionsByBand(questions: readonly CyclePlanQuestion[]) {
  return Object.fromEntries(
    ALL_BANDS.map((band) => [
      band,
      questions.filter((question) => question.juzBand === band).length
    ])
  ) as Record<JuzBand, number>;
}

function takeFromDeck(
  deck: CyclePage[],
  count: number,
  slot: CyclePlanQuestion["slot"],
  segment: string
) {
  const taken = deck.splice(0, count);
  return taken.map((page) => ({
    pageNumber: page.pageNumber,
    juzBand: page.juzBand,
    slot,
    segment
  }));
}

function splitIntoQuarters(pages: readonly CyclePage[]) {
  return Array.from({ length: 4 }, (_, index) => {
    const start = Math.floor((pages.length * index) / 4);
    const end = Math.floor((pages.length * (index + 1)) / 4);
    return pages.slice(start, end);
  });
}

function emptyWildcardQuotas() {
  return { A: 0, B: 0, C: 0 } satisfies Record<JuzBand, number>;
}

function pageBelongsToScope(page: CyclePage, scope: MemorizationScope) {
  if (scope === "THIRTY_JUZ") return true;
  if (scope === "TWENTY_JUZ")
    return page.juzBand === "A" || page.juzBand === "B";
  return page.juzBand === "A";
}
