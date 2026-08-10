import "server-only";
import { randomBytes } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { productConfig } from "@/lib/config";
import { prisma } from "@/lib/db/prisma";
import { createCyclePlan } from "./cycle/plan";
import { CryptoRandomSource, SeededRandomSource } from "./random";
import { generateQuestionSource, joinArabicWords, nextBucket } from "./question/generator";
import type { CyclePlan, HintType, PublicQuestion, QuranWordRef, RecallAssessment } from "./types";
import {
  assertHintLimit,
  projectExtensionHint,
  projectJuzHint,
  projectNextVerseHint,
  projectSurahHint
} from "./hint/service";

export async function getOrAllocateNextPackage(userId: string) {
  return retrySerialization(async () =>
    prisma.$transaction(
      async (tx) => {
        const cycle = await getOrCreateActiveCycle(tx, userId);
        const existing = await tx.memorizationPackage.findFirst({
          where: { userId, cycleId: cycle.id, state: "IN_PROGRESS" },
          orderBy: { packageNumber: "desc" },
          include: { questions: { orderBy: { orderInPackage: "asc" }, include: { hintEvents: true, assessment: true } } }
        });
        if (existing) return packageDto(tx, existing.id, userId);

        if (cycle.nextPackageNo > productConfig.packagesPerCycle) {
          await tx.memorizationCycle.update({
            where: { id: cycle.id },
            data: { state: "COMPLETED", completedAt: new Date() }
          });
          const nextCycle = await createCycle(tx, userId, cycle.cycleNumber + 1);
          return allocatePackage(tx, userId, nextCycle);
        }

        return allocatePackage(tx, userId, cycle);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 }
    )
  );
}

export async function getCurrentPackage(userId: string) {
  const pkg = await prisma.memorizationPackage.findFirst({
    where: { userId, state: "IN_PROGRESS" },
    orderBy: { createdAt: "desc" }
  });
  if (!pkg) return null;
  return packageDto(prisma, pkg.id, userId);
}

export async function requestQuestionHint(userId: string, questionId: string, type: HintType) {
  return retrySerialization(async () =>
    prisma.$transaction(
      async (tx) => {
        const question = await tx.memorizationQuestion.findFirst({
          where: { id: questionId, userId },
          include: { hintEvents: true }
        });
        if (!question) throw new Error("Pertanyaan tidak ditemukan.");
        if (question.state === "ASSESSED") throw new Error("Pertanyaan sudah dinilai.");

        const existingOfType = question.hintEvents.filter((event) => event.type === type);
        if ((type === "JUZ" || type === "SURAH") && existingOfType[0]) {
          return { hint: existingOfType[0].payload, question: await publicQuestionDto(tx, question.id, userId) };
        }
        assertHintLimit(type, existingOfType.length);
        const ordinal = existingOfType.length + 1;

        if (type === "JUZ") {
          const payload = projectJuzHint(question.juzNumber);
          await tx.hintEvent.create({ data: { userId, questionId, type, ordinal, payload } });
          return { hint: payload, question: await publicQuestionDto(tx, question.id, userId) };
        }

        if (type === "SURAH") {
          const chapter = await tx.quranChapter.findUniqueOrThrow({ where: { id: question.surahId } });
          const payload = projectSurahHint(`${chapter.nameTransliterated} (${chapter.nameArabic})`);
          await tx.hintEvent.create({ data: { userId, questionId, type, ordinal, payload } });
          return { hint: payload, question: await publicQuestionDto(tx, question.id, userId) };
        }

        if (type === "EXTEND_FRAGMENT") {
          const visibleWordCount = question.visibleWordCount + 2;
          const words = await wordsFromQuestionStart(tx, question.id, visibleWordCount);
          const safeVisibleCount = words.length;
          const payload = projectExtensionHint({ ordinal, visibleWords: words });
          await tx.memorizationQuestion.update({
            where: { id: question.id },
            data: { visibleWordCount: safeVisibleCount }
          });
          await tx.hintEvent.create({ data: { userId, questionId, type, ordinal, payload } });
          return { hint: payload, question: await publicQuestionDto(tx, question.id, userId) };
        }

        const anchor = await tx.quranVerse.findUniqueOrThrow({ where: { id: question.anchorVerseId } });
        const nextVerse = await tx.quranVerse.findFirst({
          where: { globalOrder: anchor.globalOrder + ordinal },
          orderBy: { globalOrder: "asc" }
        });
        if (!nextVerse) throw new Error("Tidak ada ayat berikutnya untuk ditampilkan.");
        const payload = projectNextVerseHint({
          ordinal,
          verseKey: nextVerse.verseKey,
          textUthmani: nextVerse.textUthmani
        });
        await tx.hintEvent.create({ data: { userId, questionId, type, ordinal, payload } });
        return { hint: { ...payload, verseKey: undefined }, question: await publicQuestionDto(tx, question.id, userId) };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 }
    )
  );
}

export async function revealAnswer(userId: string, questionId: string) {
  const question = await prisma.memorizationQuestion.findFirst({
    where: { id: questionId, userId },
    include: { assessment: true }
  });
  if (!question) throw new Error("Pertanyaan tidak ditemukan.");
  const [chapter, anchorVerse, continuation] = await Promise.all([
    prisma.quranChapter.findUniqueOrThrow({ where: { id: question.surahId } }),
    prisma.quranVerse.findUniqueOrThrow({ where: { id: question.anchorVerseId } }),
    prisma.quranVerse.findUniqueOrThrow({ where: { id: question.anchorVerseId } }).then((anchor) =>
      prisma.quranVerse.findMany({
        where: { globalOrder: { gt: anchor.globalOrder } },
        orderBy: { globalOrder: "asc" },
        take: 2
      })
    )
  ]);
  await prisma.memorizationQuestion.update({
    where: { id: question.id },
    data: { state: "ANSWER_REVEALED", answerRevealedAt: question.answerRevealedAt ?? new Date() }
  });
  return {
    surah: `${chapter.nameTransliterated} (${chapter.nameArabic})`,
    verseKey: anchorVerse.verseKey,
    juz: question.juzNumber,
    page: question.primaryPageNumber,
    text: anchorVerse.textUthmani,
    continuation: continuation.map((verse) => verse.textUthmani)
  };
}

export async function submitAssessment(userId: string, questionId: string, assessment: RecallAssessment) {
  return retrySerialization(async () =>
    prisma.$transaction(
      async (tx) => {
        const question = await tx.memorizationQuestion.findFirst({
          where: { id: questionId, userId }
        });
        if (!question) throw new Error("Pertanyaan tidak ditemukan.");
        await tx.questionAssessment.upsert({
          where: { questionId },
          update: { assessment },
          create: { userId, questionId, assessment }
        });
        await tx.memorizationQuestion.update({
          where: { id: questionId },
          data: { state: "ASSESSED" }
        });
        await completePackageIfReady(tx, question.packageId);
        return packageDto(tx, question.packageId, userId);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 }
    )
  );
}

export async function getUserProgress(userId: string) {
  const cycle = await prisma.memorizationCycle.findFirst({
    where: { userId, state: "ACTIVE" },
    orderBy: { cycleNumber: "desc" },
    include: { questions: true, packages: true }
  });
  return {
    cycleNumber: cycle?.cycleNumber ?? 1,
    pagesTested: cycle?.questions.length ?? 0,
    packagesCompleted: cycle?.packages.filter((pkg) => pkg.state === "COMPLETED").length ?? 0
  };
}

async function getOrCreateActiveCycle(tx: Prisma.TransactionClient, userId: string) {
  const active = await tx.memorizationCycle.findFirst({
    where: { userId, state: "ACTIVE" },
    orderBy: { cycleNumber: "desc" }
  });
  if (active) return active;
  const last = await tx.memorizationCycle.findFirst({
    where: { userId },
    orderBy: { cycleNumber: "desc" }
  });
  return createCycle(tx, userId, (last?.cycleNumber ?? 0) + 1);
}

async function createCycle(tx: Prisma.TransactionClient, userId: string, cycleNumber: number) {
  const pages = await tx.quranPage.findMany({
    select: { pageNumber: true, juzBand: true },
    orderBy: { pageNumber: "asc" }
  });
  if (pages.length !== productConfig.mushafPages) {
    throw new Error("Data Quran belum lengkap. Jalankan sinkronisasi terlebih dahulu.");
  }
  const seed = randomBytes(16).toString("hex");
  const plan = createCyclePlan(pages, seed, new SeededRandomSource(seed));
  return tx.memorizationCycle.create({
    data: {
      userId,
      cycleNumber,
      seed,
      plan: plan as unknown as Prisma.InputJsonValue
    }
  });
}

async function allocatePackage(
  tx: Prisma.TransactionClient,
  userId: string,
  cycle: { id: string; cycleNumber: number; nextPackageNo: number; plan: Prisma.JsonValue }
) {
  const plan = cycle.plan as unknown as CyclePlan;
  const planPackage = plan.packages[cycle.nextPackageNo - 1];
  if (!planPackage) throw new Error("Paket siklus tidak ditemukan.");

  const pkg = await tx.memorizationPackage.create({
    data: {
      userId,
      cycleId: cycle.id,
      packageNumber: cycle.nextPackageNo
    }
  });

  for (const [index, planned] of planPackage.questions.entries()) {
    const words = await pageWordRefs(tx, planned.pageNumber);
    const source = generateQuestionSource({
      primaryPageNumber: planned.pageNumber,
      assignedBand: planned.juzBand,
      words,
      preferredBucket: nextBucket(index),
      rng: new CryptoRandomSource()
    });
    await tx.memorizationQuestion.create({
      data: {
        userId,
        cycleId: cycle.id,
        packageId: pkg.id,
        orderInPackage: index + 1,
        primaryPageNumber: source.primaryPageNumber,
        juzNumber: source.juzNumber,
        juzBand: source.juzBand,
        surahId: source.surahId,
        anchorVerseId: source.anchorVerseId,
        anchorVerseKey: source.anchorVerseKey,
        pagePositionBucket: source.pagePositionBucket,
        fragmentStartWordId: source.fragmentStartWordId,
        initialWordCount: source.initialWordCount,
        visibleWordCount: source.visibleWordCount
      }
    });
  }

  await tx.memorizationCycle.update({
    where: { id: cycle.id },
    data: {
      nextPackageNo: cycle.nextPackageNo + 1,
      ...(cycle.nextPackageNo === productConfig.packagesPerCycle
        ? { state: "COMPLETED" as const, completedAt: new Date() }
        : {})
    }
  });

  return packageDto(tx, pkg.id, userId);
}

async function publicQuestionDto(tx: Prisma.TransactionClient | typeof prisma, questionId: string, userId: string) {
  const question = await tx.memorizationQuestion.findFirstOrThrow({
    where: { id: questionId, userId },
    include: { hintEvents: true, assessment: true }
  });
  const visibleWords = await wordsFromQuestionStart(tx, question.id, question.visibleWordCount);
  const hintCounts = {
    JUZ: question.hintEvents.filter((event) => event.type === "JUZ").length,
    SURAH: question.hintEvents.filter((event) => event.type === "SURAH").length,
    EXTEND_FRAGMENT: question.hintEvents.filter((event) => event.type === "EXTEND_FRAGMENT").length,
    NEXT_VERSE: question.hintEvents.filter((event) => event.type === "NEXT_VERSE").length
  };
  return {
    id: question.id,
    order: question.orderInPackage,
    totalQuestions: productConfig.questionsPerPackage,
    fragmentText: joinArabicWords(visibleWords),
    availableHints: {
      juz: hintCounts.JUZ < 1,
      surah: hintCounts.SURAH < 1,
      extendFragment: hintCounts.EXTEND_FRAGMENT < question.maxExtensionCount,
      nextVerse: hintCounts.NEXT_VERSE < question.maxNextVerseCount
    },
    answerRevealed: Boolean(question.answerRevealedAt),
    assessment: question.assessment?.assessment ?? null
  } satisfies PublicQuestion;
}

async function packageDto(tx: Prisma.TransactionClient | typeof prisma, packageId: string, userId: string) {
  const pkg = await tx.memorizationPackage.findFirstOrThrow({
    where: { id: packageId, userId },
    include: { cycle: true, questions: { orderBy: { orderInPackage: "asc" } } }
  });
  const questions = await Promise.all(pkg.questions.map((question) => publicQuestionDto(tx, question.id, userId)));
  return {
    id: pkg.id,
    packageNumber: pkg.packageNumber,
    state: pkg.state,
    cycle: {
      id: pkg.cycle.id,
      cycleNumber: pkg.cycle.cycleNumber,
      state: pkg.cycle.state,
      pagesTested: await tx.memorizationQuestion.count({ where: { cycleId: pkg.cycleId } })
    },
    questions
  };
}

async function pageWordRefs(tx: Prisma.TransactionClient, pageNumber: number): Promise<QuranWordRef[]> {
  const words = await tx.quranWord.findMany({
    where: { pageNumber, charTypeName: "word" },
    orderBy: { globalOrder: "asc" },
    include: { verse: true }
  });
  return words.map((word) => ({
    id: word.id,
    verseId: word.verseId,
    verseKey: word.verseKey,
    chapterId: word.verse.chapterId,
    verseNumber: word.verse.verseNumber,
    juzNumber: word.verse.juzNumber,
    pageNumber: word.pageNumber,
    position: word.position,
    globalOrder: word.globalOrder,
    lineNumber: word.lineNumber,
    textUthmani: word.textUthmani
  }));
}

async function wordsFromQuestionStart(
  tx: Prisma.TransactionClient | typeof prisma,
  questionId: string,
  count: number
) {
  const question = await tx.memorizationQuestion.findUniqueOrThrow({ where: { id: questionId } });
  const start = await tx.quranWord.findUniqueOrThrow({ where: { id: question.fragmentStartWordId } });
  return tx.quranWord.findMany({
    where: {
      verseId: question.anchorVerseId,
      globalOrder: { gte: start.globalOrder }
    },
    orderBy: { globalOrder: "asc" },
    take: count
  });
}

async function completePackageIfReady(tx: Prisma.TransactionClient, packageId: string) {
  const questions = await tx.memorizationQuestion.findMany({
    where: { packageId },
    include: { assessment: true }
  });
  if (questions.length === productConfig.questionsPerPackage && questions.every((question) => question.assessment)) {
    await tx.memorizationPackage.update({
      where: { id: packageId },
      data: { state: "COMPLETED", completedAt: new Date() }
    });
  }
}

async function retrySerialization<T>(fn: () => Promise<T>, attempts = 8): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryablePersistenceConflict(error)) break;
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
  throw lastError;
}

function isRetryablePersistenceConflict(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return ["P2002", "P2034"].includes(error.code);
  }
  if (error && typeof error === "object") {
    const maybe = error as { cause?: { originalCode?: string }; name?: string };
    return maybe.cause?.originalCode === "40001" || maybe.name === "DriverAdapterError";
  }
  return false;
}
