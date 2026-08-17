import { describe, expect, it } from "vitest";
import {
  assertHintLimit,
  projectExtensionHint,
  projectJuzHint,
  projectNextVerseHint,
  projectSurahHint
} from "@/lib/memorization/hint/service";

describe("hint projections", () => {
  it("JUZ reveals only the juz text", () => {
    expect(projectJuzHint(17)).toEqual({
      type: "JUZ",
      ordinal: 1,
      text: "Juz 17"
    });
  });

  it("SURAH reveals only the supplied surah name", () => {
    expect(projectSurahHint("Al-Fatihah")).toEqual({
      type: "SURAH",
      ordinal: 1,
      text: "Al-Fatihah"
    });
  });

  it("EXTEND_FRAGMENT returns exact contiguous supplied text", () => {
    expect(
      projectExtensionHint({
        ordinal: 2,
        visibleWords: [{ textUthmani: "a" }, { textUthmani: "b" }]
      }).text
    ).toBe("a b");
  });

  it("NEXT_VERSE projects only displayable verse text", () => {
    expect(
      projectNextVerseHint({
        ordinal: 1,
        verseKey: "fixture:2",
        textUthmani: "next verse"
      })
    ).toEqual({
      type: "NEXT_VERSE",
      ordinal: 1,
      text: "next verse"
    });
  });

  it("enforces server-side hint limits", () => {
    expect(() => assertHintLimit("JUZ", 1)).toThrow(/Batas/);
    expect(() => assertHintLimit("EXTEND_FRAGMENT", 3)).toThrow(/Batas/);
    expect(() => assertHintLimit("NEXT_VERSE", 3)).toThrow(/Batas/);
  });
});
