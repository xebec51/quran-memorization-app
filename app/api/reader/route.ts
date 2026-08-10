import { unstable_cache } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import {
  measureServerTiming,
  withServerTiming
} from "@/lib/performance/timing";
import { jsonOk, routeError } from "@/lib/validation/api";

const schema = z.object({
  mode: z.enum(["page", "surah", "juz"]).default("page"),
  value: z.coerce.number().int().positive().default(1)
});

const getCachedReaderData = unstable_cache(
  async (mode: "page" | "surah" | "juz", value: number) => {
    const where =
      mode === "page"
        ? { pageNumber: value }
        : mode === "surah"
          ? { chapterId: value }
          : { juzNumber: value };
    const verses = await prisma.quranVerse.findMany({
      where,
      orderBy: { globalOrder: "asc" },
      select: {
        verseKey: true,
        textUthmani: true,
        verseNumber: true,
        juzNumber: true,
        pageNumber: true,
        chapter: {
          select: {
            nameTransliterated: true,
            nameArabic: true
          }
        }
      }
    });
    return {
      mode,
      value,
      verses: verses.map((verse) => ({
        verseKey: verse.verseKey,
        textUthmani: verse.textUthmani,
        chapter: verse.chapter.nameTransliterated,
        chapterArabic: verse.chapter.nameArabic,
        verseNumber: verse.verseNumber,
        juzNumber: verse.juzNumber,
        pageNumber: verse.pageNumber
      }))
    };
  },
  ["quran-reader"],
  { revalidate: 86_400, tags: ["quran-reader"] }
);

export async function GET(request: Request) {
  return withServerTiming(async () => {
    try {
      const { searchParams } = new URL(request.url);
      const input = schema.parse({
        mode: searchParams.get("mode") ?? "page",
        value: searchParams.get("value") ?? "1"
      });
      const data = await measureServerTiming("reader_query", () =>
        getCachedReaderData(input.mode, input.value)
      );
      return jsonOk(data, {
        headers: {
          "Cache-Control":
            "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800"
        }
      });
    } catch (error) {
      return routeError(error);
    }
  });
}
