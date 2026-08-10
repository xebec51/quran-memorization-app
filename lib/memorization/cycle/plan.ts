import { productConfig } from "@/lib/config";
import type { RandomSource } from "../random";
import type { CyclePage, CyclePlan, CyclePlanQuestion, JuzBand } from "../types";
import { ALL_BANDS } from "./constants";

export function calculateWildcardQuotas(pages: readonly CyclePage[]) {
  const counts = countPagesByBand(pages);
  const quotas = Object.fromEntries(
    ALL_BANDS.map((band) => [band, counts[band] - productConfig.packagesPerCycle])
  ) as Record<JuzBand, number>;

  for (const band of ALL_BANDS) {
    if (quotas[band] < 0) {
      throw new Error(
        `Juz band ${band} has ${counts[band]} pages, below the ${productConfig.packagesPerCycle} mandatory requirement`
      );
    }
  }

  const wildcardTotal = ALL_BANDS.reduce((sum, band) => sum + quotas[band], 0);
  if (wildcardTotal !== productConfig.packagesPerCycle) {
    throw new Error(
      `Wildcard quota mismatch: expected ${productConfig.packagesPerCycle}, got ${wildcardTotal}`
    );
  }

  return quotas;
}

export function createCyclePlan(
  pages: readonly CyclePage[],
  seed: string,
  rng: RandomSource
): CyclePlan {
  validatePageSet(pages);
  const wildcardQuotas = calculateWildcardQuotas(pages);
  const shuffledByBand = Object.fromEntries(
    ALL_BANDS.map((band) => [
      band,
      rng.shuffle(pages.filter((page) => page.juzBand === band))
    ])
  ) as Record<JuzBand, CyclePage[]>;

  const mandatoryDecks = Object.fromEntries(
    ALL_BANDS.map((band) => [band, shuffledByBand[band].slice(0, productConfig.packagesPerCycle)])
  ) as Record<JuzBand, CyclePage[]>;

  const wildcardPools = Object.fromEntries(
    ALL_BANDS.map((band) => [band, shuffledByBand[band].slice(productConfig.packagesPerCycle)])
  ) as Record<JuzBand, CyclePage[]>;

  const wildcardBandDeck = rng.shuffle(
    ALL_BANDS.flatMap((band) => Array.from({ length: wildcardQuotas[band] }, () => band))
  );

  const packages = Array.from({ length: productConfig.packagesPerCycle }, (_, packageIndex) => {
    const mandatoryQuestions: CyclePlanQuestion[] = ALL_BANDS.map((band) => {
      const page = mandatoryDecks[band][packageIndex];
      return { pageNumber: page.pageNumber, juzBand: band, slot: "MANDATORY" };
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
        { pageNumber: wildcardPage.pageNumber, juzBand: wildcardBand, slot: "WILDCARD" as const }
      ])
    };
  });

  const consumedPages = packages.flatMap((pkg) => pkg.questions.map((question) => question.pageNumber));
  const uniquePages = new Set(consumedPages);
  if (consumedPages.length !== productConfig.mushafPages || uniquePages.size !== productConfig.mushafPages) {
    throw new Error("Cycle plan failed the 604 unique page invariant");
  }

  return {
    version: 1,
    seed,
    packagesPerCycle: productConfig.packagesPerCycle,
    questionsPerPackage: productConfig.questionsPerPackage,
    wildcardQuotas,
    packages
  };
}

export function validateCyclePlan(plan: CyclePlan) {
  if (plan.packages.length !== productConfig.packagesPerCycle) {
    throw new Error(`Expected 151 packages, found ${plan.packages.length}`);
  }

  const seenPages = new Set<number>();
  for (const pkg of plan.packages) {
    if (pkg.questions.length !== productConfig.questionsPerPackage) {
      throw new Error(`Package ${pkg.packageNumber} does not contain exactly four questions`);
    }
    for (const band of ALL_BANDS) {
      if (!pkg.questions.some((question) => question.juzBand === band)) {
        throw new Error(`Package ${pkg.packageNumber} is missing band ${band}`);
      }
    }
    for (const question of pkg.questions) {
      if (seenPages.has(question.pageNumber)) {
        throw new Error(`Primary page ${question.pageNumber} repeats inside the cycle`);
      }
      seenPages.add(question.pageNumber);
    }
  }

  if (seenPages.size !== productConfig.mushafPages) {
    throw new Error(`Expected 604 unique primary pages, found ${seenPages.size}`);
  }

  const wildcardCounts = Object.fromEntries(ALL_BANDS.map((band) => [band, 0])) as Record<JuzBand, number>;
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

function countPagesByBand(pages: readonly CyclePage[]) {
  return Object.fromEntries(
    ALL_BANDS.map((band) => [band, pages.filter((page) => page.juzBand === band).length])
  ) as Record<JuzBand, number>;
}
