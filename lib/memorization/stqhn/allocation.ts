import { allStqhnPackagesCompletedError } from "../errors";
import type { RandomSource } from "../random";

/**
 * Pure selection logic for getOrAllocateStqhnPackage
 * (lib/memorization/stqhn/service.ts) - factored out into its own
 * server-only-free module (no DB, no "server-only" import) so the "avoid
 * a completed package while an untried one remains, else exhausted"
 * decision can be unit-tested directly (see
 * tests/unit/stqhn-package-allocation.test.ts) without a database or a
 * real 372-question bank.
 */
export function chooseStqhnPackageId(
  allPackageIds: readonly string[],
  completedPackageIds: ReadonlySet<string>,
  rng: RandomSource
): string {
  if (allPackageIds.length === 0) {
    throw new Error(
      "Bank soal STQHN belum diimpor - jalankan npm run stqhn:import."
    );
  }
  const candidates = allPackageIds.filter((id) => !completedPackageIds.has(id));
  if (candidates.length === 0) throw allStqhnPackagesCompletedError();
  return candidates[rng.int(0, candidates.length)];
}
