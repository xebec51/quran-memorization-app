import { createServerClient } from "@quranjs/api/server";
import type { PageNumber, Verse } from "@quranjs/api";
import type { ProviderChapter, ProviderVerse, QuranProvider } from "./types";

/**
 * Only ever instantiated by scripts/sync-quran.ts, run standalone via tsx -
 * never by the Next.js app runtime. It deliberately reads process.env
 * directly instead of the server-only-guarded getServerEnv(): the
 * "server-only" package throws outside a Next.js bundler context, which
 * would break this exact script.
 */
export class QuranFoundationProvider implements QuranProvider {
  private clientId = process.env.QF_CLIENT_ID ?? "";
  private clientSecret = process.env.QF_CLIENT_SECRET ?? "";
  private qfEnv = process.env.QF_ENV === "production" ? "production" : "prelive";

  private client = createServerClient({
    clientId: this.clientId,
    clientSecret: this.clientSecret,
    services:
      this.qfEnv === "production"
        ? {
            tokenHost: "https://oauth2.quran.foundation",
            oauth2BaseUrl: "https://oauth2.quran.foundation",
            contentBaseUrl: "https://apis.quran.foundation/content",
            searchBaseUrl: "https://apis.quran.foundation/search"
          }
        : {
            tokenHost: "https://prelive-oauth2.quran.foundation",
            oauth2BaseUrl: "https://prelive-oauth2.quran.foundation",
            contentBaseUrl: "https://apis-prelive.quran.foundation/content",
            searchBaseUrl: "https://apis-prelive.quran.foundation/search"
          }
  });

  async getChapters(): Promise<ProviderChapter[]> {
    const chapters = await this.client.content.v4.chapters.list();
    return chapters.map((chapter) => ({
      id: chapter.id,
      nameArabic: chapter.nameArabic,
      nameSimple: chapter.nameSimple,
      nameTransliterated: chapter.transliteratedName ?? chapter.nameSimple,
      translatedName: chapter.translatedName?.name,
      versesCount: chapter.versesCount,
      revelationPlace: chapter.revelationPlace,
      bismillahPre: chapter.bismillahPre
    }));
  }

  async getVersesByPage(pageNumber: number): Promise<ProviderVerse[]> {
    const verses = await this.client.content.v4.verses.byPage(pageNumber as PageNumber, {
      words: true,
      fields: {
        chapterId: true,
        textUthmani: true,
        textUthmaniSimple: true
      },
      wordFields: {
        textUthmani: true,
        location: true,
        verseKey: true
      },
      perPage: 300
    });
    return verses.map((verse) => normalizeVerse(verse));
  }
}

function normalizeVerse(verse: Verse): ProviderVerse {
  const chapterId = Number(verse.chapterId ?? verse.verseKey.split(":")[0]);
  return {
    id: verse.id,
    verseKey: verse.verseKey,
    chapterId,
    verseNumber: verse.verseNumber,
    juzNumber: verse.juzNumber,
    pageNumber: verse.pageNumber,
    textUthmani: verse.textUthmani ?? "",
    textUthmaniSimple: verse.textUthmaniSimple,
    words: (verse.words ?? [])
      .filter((word) => word.charTypeName === "word")
      .map((word) => ({
        id: word.id ?? deriveWordId(verse.id, word.position),
        position: word.position,
        pageNumber: word.pageNumber ?? verse.pageNumber,
        lineNumber: word.lineNumber,
        textUthmani: word.textUthmani ?? word.text ?? "",
        charTypeName: word.charTypeName,
        location: word.location,
        verseKey: word.verseKey ?? verse.verseKey
      }))
  };
}

function deriveWordId(verseId: number, position: number) {
  return verseId * 1000 + position;
}
