import type { JuzBand } from "@/lib/memorization/types";
import { bandForJuz } from "@/lib/memorization/cycle/constants";

export type PageWordBandInput = {
  juzNumber: number;
  globalOrder: number;
};

export function classifyPageBand(words: readonly PageWordBandInput[]): {
  juzBand: JuzBand;
  firstJuz: number;
  lastJuz: number;
} {
  if (words.length === 0)
    throw new Error("Cannot classify an empty Quran page");
  const sorted = [...words].sort((a, b) => a.globalOrder - b.globalOrder);
  const firstJuz = sorted[0].juzNumber;
  const lastJuz = sorted[sorted.length - 1].juzNumber;
  const counts = new Map<number, number>();
  for (const word of sorted)
    counts.set(word.juzNumber, (counts.get(word.juzNumber) ?? 0) + 1);
  const [dominantJuz] = [...counts.entries()].sort((left, right) => {
    const countDelta = right[1] - left[1];
    return countDelta === 0 ? left[0] - right[0] : countDelta;
  })[0];
  return { juzBand: bandForJuz(dominantJuz), firstJuz, lastJuz };
}
