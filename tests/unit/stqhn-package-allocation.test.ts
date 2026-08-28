import { describe, expect, it } from "vitest";
import { chooseStqhnPackageId } from "@/lib/memorization/stqhn/allocation";
import type { RandomSource } from "@/lib/memorization/random";

/** Deterministic stand-in for CryptoRandomSource - always picks index 0. */
const firstPick: RandomSource = {
  int: () => 0,
  shuffle: (items) => [...items]
};

describe("chooseStqhnPackageId", () => {
  it("throws if no package exists at all (bank not imported)", () => {
    expect(() => chooseStqhnPackageId([], new Set(), firstPick)).toThrow(
      /belum diimpor/
    );
  });

  it("picks only from packages the user has not already completed", () => {
    const chosen = chooseStqhnPackageId(
      ["a", "b", "c"],
      new Set(["a", "b"]),
      firstPick
    );
    expect(chosen).toBe("c");
  });

  it("never returns an already-completed package while an untried one remains", () => {
    for (let index = 0; index < 3; index += 1) {
      const rng: RandomSource = { int: () => index, shuffle: (i) => [...i] };
      const chosen = chooseStqhnPackageId(["a", "b", "c"], new Set(["a"]), rng);
      expect(chosen).not.toBe("a");
    }
  });

  it("throws allStqhnPackagesCompletedError once every package has been completed - the exact bug this guards against regressing", () => {
    expect(() =>
      chooseStqhnPackageId(["a", "b", "c"], new Set(["a", "b", "c"]), firstPick)
    ).toThrow(/menyelesaikan seluruh paket/);
  });
});
