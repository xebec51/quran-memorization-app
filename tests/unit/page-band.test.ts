import { describe, expect, it } from "vitest";
import { classifyPageBand } from "@/lib/quran/validation/page-band";

describe("page band classification", () => {
  it("uses dominant word juz and earliest juz on ties", () => {
    expect(
      classifyPageBand([
        { juzNumber: 10, globalOrder: 1 },
        { juzNumber: 11, globalOrder: 2 },
        { juzNumber: 11, globalOrder: 3 }
      ])
    ).toEqual({ juzBand: "B", firstJuz: 10, lastJuz: 11 });

    expect(
      classifyPageBand([
        { juzNumber: 10, globalOrder: 1 },
        { juzNumber: 11, globalOrder: 2 }
      ]).juzBand
    ).toBe("A");
  });
});
