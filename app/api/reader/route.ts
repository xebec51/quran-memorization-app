import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { jsonOk, routeError } from "@/lib/validation/api";

const schema = z.object({
  mode: z.enum(["page", "surah", "juz"]).default("page"),
  value: z.coerce.number().int().positive().default(1)
});

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const input = schema.parse({
      mode: searchParams.get("mode") ?? "page",
      value: searchParams.get("value") ?? "1"
    });
    const where =
      input.mode === "page"
        ? { pageNumber: input.value }
        : input.mode === "surah"
          ? { chapterId: input.value }
          : { juzNumber: input.value };
    const verses = await prisma.quranVerse.findMany({
      where,
      orderBy: { globalOrder: "asc" },
      include: { chapter: true }
    });
    const chapters = await prisma.quranChapter.findMany({ orderBy: { id: "asc" } });
    return jsonOk({
      mode: input.mode,
      value: input.value,
      chapters,
      verses: verses.map((verse) => ({
        verseKey: verse.verseKey,
        textUthmani: verse.textUthmani,
        chapter: verse.chapter.nameTransliterated,
        chapterArabic: verse.chapter.nameArabic,
        verseNumber: verse.verseNumber,
        juzNumber: verse.juzNumber,
        pageNumber: verse.pageNumber
      }))
    });
  } catch (error) {
    return routeError(error);
  }
}
