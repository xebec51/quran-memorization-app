import type { CyclePage } from "@/lib/memorization/types";

export function syntheticCyclePages(): CyclePage[] {
  return [
    ...rangePages(1, 202, "A"),
    ...rangePages(203, 403, "B"),
    ...rangePages(404, 604, "C")
  ];
}

function rangePages(start: number, end: number, juzBand: CyclePage["juzBand"]) {
  return Array.from({ length: end - start + 1 }, (_, index) => ({
    pageNumber: start + index,
    juzBand
  }));
}
