import { productConfig } from "@/lib/config";
import type { HintType } from "../types";
import { joinArabicWords } from "../question/generator";

export type HintProjection = {
  type: HintType;
  ordinal: number;
  text: string;
};

export function assertHintLimit(type: HintType, existingCount: number) {
  const limit =
    type === "EXTEND_FRAGMENT"
      ? productConfig.extensionLimit
      : type === "NEXT_VERSE"
        ? productConfig.nextVerseLimit
        : 1;
  if (existingCount >= limit) {
    throw new Error("Batas petunjuk untuk pertanyaan ini sudah tercapai.");
  }
}

export function projectJuzHint(juzNumber: number): HintProjection {
  return { type: "JUZ", ordinal: 1, text: `Juz ${juzNumber}` };
}

export function projectSurahHint(name: string): HintProjection {
  return { type: "SURAH", ordinal: 1, text: name };
}

export function projectExtensionHint(params: {
  ordinal: number;
  visibleWords: readonly { textUthmani: string }[];
}): HintProjection {
  return {
    type: "EXTEND_FRAGMENT",
    ordinal: params.ordinal,
    text: joinArabicWords(params.visibleWords)
  };
}

export function projectNextVerseHint(params: {
  ordinal: number;
  verseKey: string;
  textUthmani: string;
}): HintProjection {
  return {
    type: "NEXT_VERSE",
    ordinal: params.ordinal,
    text: `${params.textUthmani}`
  };
}
