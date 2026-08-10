import type { JuzBand } from "../types";

export const JUZ_BANDS: Record<JuzBand, { min: number; max: number; label: string }> = {
  A: { min: 1, max: 10, label: "Juz 1-10" },
  B: { min: 11, max: 20, label: "Juz 11-20" },
  C: { min: 21, max: 30, label: "Juz 21-30" }
};

export const ALL_BANDS: JuzBand[] = ["A", "B", "C"];

export function bandForJuz(juzNumber: number): JuzBand {
  if (juzNumber >= 1 && juzNumber <= 10) return "A";
  if (juzNumber >= 11 && juzNumber <= 20) return "B";
  if (juzNumber >= 21 && juzNumber <= 30) return "C";
  throw new Error(`Invalid juz number: ${juzNumber}`);
}
