export type ProviderChapter = {
  id: number;
  nameArabic: string;
  nameSimple: string;
  nameTransliterated: string;
  translatedName?: string;
  versesCount: number;
  revelationPlace?: string;
  bismillahPre: boolean;
};

export type ProviderWord = {
  id: number;
  position: number;
  pageNumber: number;
  lineNumber?: number;
  textUthmani: string;
  charTypeName: string;
  location?: string;
  verseKey: string;
};

export type ProviderVerse = {
  id: number;
  verseKey: string;
  chapterId: number;
  verseNumber: number;
  juzNumber: number;
  pageNumber: number;
  textUthmani: string;
  textUthmaniSimple?: string;
  words: ProviderWord[];
};

export interface QuranProvider {
  getChapters(): Promise<ProviderChapter[]>;
  getVersesByPage(pageNumber: number): Promise<ProviderVerse[]>;
}
