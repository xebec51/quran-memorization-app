import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { productConfig } from "@/lib/config";
import { prisma } from "@/lib/db/prisma";
import { measureServerTiming } from "@/lib/performance/timing";
import { createCyclePlan } from "./cycle/plan";
import { CryptoRandomSource, SeededRandomSource } from "./random";
import { generateQuestionSource, nextBucket } from "./question/generator";
import type {
  AssessmentMutationResult,
  CyclePlan,
  HintCounts,
  HintMutationResult,
  HintType,
  PublicHint,
  PublicQuestion,
  QuranWordRef,
  RecallAssessment
} from "./types";
import {
  assertHintLimit,
  projectExtensionHint,
  projectJuzHint,
  projectNextVerseHint,
  projectSurahHint
} from "./hint/service";

const publicQuestionSelect = {
  id: true,
  orderInPackage: true,
  visibleFragmentText: true,
  answerRevealedAt: true,
  maxExtensionCount: true,
  maxNextVerseCount: true,
  hintEvents: {
    select: {
      type: true
    }
  },
  assessment: {
    select: {
      assessment: true
    }
  }
} satisfies Prisma.MemorizationQuestionSelect;

const packageDtoSelect = {
  id: true,
  packageNumber: true,
  state: true,
  cycleId: true,
  cycle: {
    select: {
      id: true,
      cycleNumber: true,
      state: true,
      _count: {
        select: {
          questions: true
        }
      }
    }
  },
  questions: {
    orderBy: { orderInPackage: "asc" },
    select: publicQuestionSelect
  }
} satisfies Prisma.MemorizationPackageSelect;

const cycleForAllocationSelect = {
  id: true,
  cycleNumber: true,
  state: true,
  plan: true,
  nextPackageNo: true
} satisfies Prisma.MemorizationCycleSelect;

const hintQuestionSelect = {
  id: true,
  state: true,
  juzNumber: true,
  surahId: true,
  anchorVerseId: true,
  visibleWordCount: true,
  maxExtensionCount: true,
  maxNextVerseCount: true,
  hintEvents: {
    select: {
      type: true,
      ordinal: true,
      payload: true
    }
  }
} satisfies Prisma.MemorizationQuestionSelect;

const quranWordRefSelect = {
  id: true,
  verseId: true,
  verseKey: true,
  position: true,
  globalOrder: true,
  pageNumber: true,
  lineNumber: true,
  textUthmani: true,
  verse: {
    select: {
      chapterId: true,
      verseNumber: true,
      juzNumber: true
    }
  }
} satisfies Prisma.QuranWordSelect;

const extensionWordSelect = {
  position: true,
  textUthmani: true
} satisfies Prisma.QuranWordSelect;

export async function getOrAllocateNextPackage(userId: string) {
  return measureServerTiming("next_package", async () => {
    const existing = await findExistingPackage(prisma, userId);
    if (existing) return packageDtoFromRecord(existing);

    return retrySerialization(async () =>
      prisma.$transaction(
        async (tx) => {
          const existingInsideTransaction = await findExistingPackage(
            tx,
            userId
          );
          if (existingInsideTransaction)
            return packageDtoFromRecord(existingInsideTransaction);

          let cycle = await tx.memorizationCycle.findFirst({
            where: { userId, state: "ACTIVE" },
            orderBy: { cycleNumber: "desc" },
            select: cycleForAllocationSelect
          });

          if (!cycle) {
            const lastCycle = await tx.memorizationCycle.findFirst({
              where: { userId },
              orderBy: { cycleNumber: "desc" },
              select: { cycleNumber: true }
            });
            cycle = await createCycle(
              tx,
              userId,
              (lastCycle?.cycleNumber ?? 0) + 1
            );
          }

          if (cycle.nextPackageNo > productConfig.packagesPerCycle) {
            await tx.memorizationCycle.update({
              where: { id: cycle.id },
              data: { state: "COMPLETED", completedAt: new Date() },
              select: { id: true }
            });
            cycle = await createCycle(tx, userId, cycle.cycleNumber + 1);
          }

          return allocatePackage(tx, userId, cycle);
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 20_000
        }
      )
    );
  });
}

export async function getCurrentPackage(userId: string) {
  return measureServerTiming("current_package", async () => {
    const pkg = await findExistingPackage(prisma, userId);
    return pkg ? packageDtoFromRecord(pkg) : null;
  });
}

export async function requestQuestionHint(
  userId: string,
  questionId: string,
  type: HintType
): Promise<HintMutationResult> {
  return measureServerTiming("hint_request", async () =>
    retrySerialization(async () =>
      prisma.$transaction(
        async (tx) => {
          const question = await tx.memorizationQuestion.findFirst({
            where: { id: questionId, userId },
            select: hintQuestionSelect
          });
          if (!question) throw new Error("Pertanyaan tidak ditemukan.");
          if (question.state === "ASSESSED")
            throw new Error("Pertanyaan sudah dinilai.");

          const counts = hintCountsFromEvents(question.hintEvents);
          const existingOfType = question.hintEvents.find(
            (event) => event.type === type
          );
          if ((type === "JUZ" || type === "SURAH") && existingOfType) {
            return hintMutationResult(
              question,
              counts,
              publicHintFromPayload(existingOfType.payload)
            );
          }

          assertHintLimit(type, counts[type]);
          const ordinal = counts[type] + 1;

          if (type === "JUZ") {
            const payload = projectJuzHint(question.juzNumber);
            await createHintEvent(
              tx,
              userId,
              questionId,
              type,
              ordinal,
              payload
            );
            const nextCounts = incrementHintCount(counts, type);
            return hintMutationResult(question, nextCounts, payload);
          }

          if (type === "SURAH") {
            const chapter = await tx.quranChapter.findUniqueOrThrow({
              where: { id: question.surahId },
              select: { nameTransliterated: true, nameArabic: true }
            });
            const payload = projectSurahHint(
              `${chapter.nameTransliterated} (${chapter.nameArabic})`
            );
            await createHintEvent(
              tx,
              userId,
              questionId,
              type,
              ordinal,
              payload
            );
            const nextCounts = incrementHintCount(counts, type);
            return hintMutationResult(question, nextCounts, payload);
          }

          if (type === "EXTEND_FRAGMENT") {
            const verseWords = await wordsForExtension(
              tx,
              question.anchorVerseId
            );
            const safeVisibleCount = Math.min(
              question.visibleWordCount + 2,
              verseWords.length
            );
            const payload = projectExtensionHint({
              ordinal,
              visibleWords: verseWords.slice(0, safeVisibleCount)
            });
            await tx.memorizationQuestion.update({
              where: { id: question.id },
              data: {
                visibleWordCount: safeVisibleCount,
                visibleFragmentText: payload.text
              },
              select: { id: true }
            });
            await createHintEvent(
              tx,
              userId,
              questionId,
              type,
              ordinal,
              payload
            );
            const nextCounts = incrementHintCount(counts, type);
            return hintMutationResult(
              question,
              nextCounts,
              payload,
              payload.text
            );
          }

          const anchor = await tx.quranVerse.findUniqueOrThrow({
            where: { id: question.anchorVerseId },
            select: { globalOrder: true }
          });
          const nextVerse = await tx.quranVerse.findFirst({
            where: { globalOrder: anchor.globalOrder + ordinal },
            orderBy: { globalOrder: "asc" },
            select: { verseKey: true, textUthmani: true }
          });
          if (!nextVerse)
            throw new Error("Tidak ada ayat berikutnya untuk ditampilkan.");
          const payload = projectNextVerseHint({
            ordinal,
            verseKey: nextVerse.verseKey,
            textUthmani: nextVerse.textUthmani
          });
          await createHintEvent(tx, userId, questionId, type, ordinal, payload);
          const nextCounts = incrementHintCount(counts, type);
          return hintMutationResult(question, nextCounts, payload);
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 15_000
        }
      )
    )
  );
}

export async function revealAnswer(userId: string, questionId: string) {
  return measureServerTiming("reveal_request", async () => {
    const question = await prisma.memorizationQuestion.findFirst({
      where: { id: questionId, userId },
      select: {
        id: true,
        surahId: true,
        anchorVerseId: true,
        juzNumber: true,
        primaryPageNumber: true,
        answerRevealedAt: true
      }
    });
    if (!question) throw new Error("Pertanyaan tidak ditemukan.");
    const [chapter, anchorVerse] = await Promise.all([
      prisma.quranChapter.findUniqueOrThrow({
        where: { id: question.surahId },
        select: { nameTransliterated: true, nameArabic: true }
      }),
      prisma.quranVerse.findUniqueOrThrow({
        where: { id: question.anchorVerseId },
        select: { verseKey: true, globalOrder: true, textUthmani: true }
      })
    ]);
    const continuation = await prisma.quranVerse.findMany({
      where: { globalOrder: { gt: anchorVerse.globalOrder } },
      orderBy: { globalOrder: "asc" },
      take: 2,
      select: { textUthmani: true }
    });
    if (!question.answerRevealedAt) {
      await prisma.memorizationQuestion.update({
        where: { id: question.id },
        data: { state: "ANSWER_REVEALED", answerRevealedAt: new Date() },
        select: { id: true }
      });
    }
    return {
      surah: `${chapter.nameTransliterated} (${chapter.nameArabic})`,
      verseKey: anchorVerse.verseKey,
      juz: question.juzNumber,
      page: question.primaryPageNumber,
      text: anchorVerse.textUthmani,
      continuation: continuation.map((verse) => verse.textUthmani)
    };
  });
}

export async function submitAssessment(
  userId: string,
  questionId: string,
  assessment: RecallAssessment
): Promise<AssessmentMutationResult> {
  return measureServerTiming("assessment_request", async () =>
    retrySerialization(async () =>
      prisma.$transaction(
        async (tx) => {
          const question = await tx.memorizationQuestion.findFirst({
            where: { id: questionId, userId },
            select: { id: true, packageId: true }
          });
          if (!question) throw new Error("Pertanyaan tidak ditemukan.");

          await tx.questionAssessment.upsert({
            where: { questionId },
            update: { assessment },
            create: { userId, questionId, assessment },
            select: { id: true }
          });
          await tx.memorizationQuestion.update({
            where: { id: questionId },
            data: { state: "ASSESSED" },
            select: { id: true }
          });

          const packageCompleted = await completePackageIfReady(
            tx,
            question.packageId
          );
          return { questionId, assessment, packageCompleted };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 15_000
        }
      )
    )
  );
}

export async function getUserProgress(userId: string) {
  const cycle = await prisma.memorizationCycle.findFirst({
    where: { userId, state: "ACTIVE" },
    orderBy: { cycleNumber: "desc" },
    select: { id: true, cycleNumber: true }
  });
  if (!cycle) {
    return {
      cycleNumber: 1,
      pagesTested: 0,
      packagesCompleted: 0
    };
  }
  const [pagesTested, packagesCompleted] = await Promise.all([
    prisma.memorizationQuestion.count({ where: { cycleId: cycle.id } }),
    prisma.memorizationPackage.count({
      where: { cycleId: cycle.id, state: "COMPLETED" }
    })
  ]);
  return {
    cycleNumber: cycle.cycleNumber,
    pagesTested,
    packagesCompleted
  };
}

async function findExistingPackage(
  tx: Prisma.TransactionClient | typeof prisma,
  userId: string
) {
  return tx.memorizationPackage.findFirst({
    where: { userId, state: "IN_PROGRESS" },
    orderBy: { createdAt: "desc" },
    select: packageDtoSelect
  });
}

async function createCycle(
  tx: Prisma.TransactionClient,
  userId: string,
  cycleNumber: number
) {
  const pages = await tx.quranPage.findMany({
    select: { pageNumber: true, juzBand: true },
    orderBy: { pageNumber: "asc" }
  });
  if (pages.length !== productConfig.mushafPages) {
    throw new Error(
      "Data Quran belum lengkap. Jalankan sinkronisasi terlebih dahulu."
    );
  }
  const seed = randomBytes(16).toString("hex");
  const plan = createCyclePlan(pages, seed, new SeededRandomSource(seed));
  return tx.memorizationCycle.create({
    data: {
      userId,
      cycleNumber,
      seed,
      plan: plan as unknown as Prisma.InputJsonValue
    },
    select: cycleForAllocationSelect
  });
}

async function allocatePackage(
  tx: Prisma.TransactionClient,
  userId: string,
  cycle: CycleForAllocation
) {
  return measureServerTiming("package_allocate", async () => {
    const plan = cycle.plan as unknown as CyclePlan;
    const planPackage = plan.packages[cycle.nextPackageNo - 1];
    if (!planPackage) throw new Error("Paket siklus tidak ditemukan.");

    const pkg = await tx.memorizationPackage.create({
      data: {
        userId,
        cycleId: cycle.id,
        packageNumber: cycle.nextPackageNo
      },
      select: { id: true, packageNumber: true, state: true }
    });

    const wordsByPage = await wordRefsForPackagePages(
      tx,
      planPackage.questions.map((question) => question.pageNumber)
    );
    const questionRows: GeneratedQuestionRow[] = [];

    for (const [index, planned] of planPackage.questions.entries()) {
      const words = wordsByPage.get(planned.pageNumber);
      if (!words)
        throw new Error(`Words for page ${planned.pageNumber} were not loaded`);
      const source = generateQuestionSource({
        primaryPageNumber: planned.pageNumber,
        assignedBand: planned.juzBand,
        words,
        preferredBucket: nextBucket(index),
        rng: new CryptoRandomSource()
      });
      questionRows.push({
        id: randomUUID(),
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
        visibleWordCount: source.visibleWordCount,
        visibleFragmentText: source.fragmentText,
        maxExtensionCount: productConfig.extensionLimit,
        maxNextVerseCount: productConfig.nextVerseLimit
      });
    }
    await tx.memorizationQuestion.createMany({ data: questionRows });

    await tx.memorizationCycle.update({
      where: { id: cycle.id },
      data: { nextPackageNo: cycle.nextPackageNo + 1 },
      select: { id: true }
    });

    return {
      id: pkg.id,
      packageNumber: pkg.packageNumber,
      state: pkg.state,
      cycle: {
        id: cycle.id,
        cycleNumber: cycle.cycleNumber,
        state: cycle.state,
        pagesTested: Math.min(
          productConfig.mushafPages,
          cycle.nextPackageNo * productConfig.questionsPerPackage
        )
      },
      questions: questionRows.map(publicQuestionFromGeneratedRow)
    };
  });
}

function packageDtoFromRecord(pkg: PackageForDto) {
  return {
    id: pkg.id,
    packageNumber: pkg.packageNumber,
    state: pkg.state,
    cycle: {
      id: pkg.cycle.id,
      cycleNumber: pkg.cycle.cycleNumber,
      state: pkg.cycle.state,
      pagesTested: pkg.cycle._count.questions
    },
    questions: pkg.questions.map(publicQuestionFromRecord)
  };
}

function publicQuestionFromRecord(question: QuestionForPublicDto) {
  const counts = hintCountsFromEvents(question.hintEvents);
  return {
    id: question.id,
    order: question.orderInPackage,
    totalQuestions: productConfig.questionsPerPackage,
    fragmentText: question.visibleFragmentText,
    availableHints: availableHintsFromCounts(question, counts),
    answerRevealed: Boolean(question.answerRevealedAt),
    assessment: question.assessment?.assessment ?? null
  } satisfies PublicQuestion;
}

function publicQuestionFromGeneratedRow(question: GeneratedQuestionRow) {
  return {
    id: question.id,
    order: question.orderInPackage,
    totalQuestions: productConfig.questionsPerPackage,
    fragmentText: question.visibleFragmentText,
    availableHints: availableHintsFromCounts(question, emptyHintCounts()),
    answerRevealed: false,
    assessment: null
  } satisfies PublicQuestion;
}

async function wordRefsForPackagePages(
  tx: Prisma.TransactionClient,
  pageNumbers: readonly number[]
): Promise<Map<number, QuranWordRef[]>> {
  const uniquePageNumbers = [...new Set(pageNumbers)];
  const pageWords = await tx.quranWord.findMany({
    where: { pageNumber: { in: uniquePageNumbers }, charTypeName: "word" },
    orderBy: [{ pageNumber: "asc" }, { globalOrder: "asc" }],
    select: quranWordRefSelect
  });

  const verseIdsByPage = new Map<number, Set<number>>();
  for (const word of pageWords) {
    const verseIds = verseIdsByPage.get(word.pageNumber) ?? new Set<number>();
    verseIds.add(word.verseId);
    verseIdsByPage.set(word.pageNumber, verseIds);
  }

  const allVerseIds = [...new Set(pageWords.map((word) => word.verseId))];
  const fullVerseWords = await tx.quranWord.findMany({
    where: { verseId: { in: allVerseIds }, charTypeName: "word" },
    orderBy: [{ verseId: "asc" }, { position: "asc" }],
    select: quranWordRefSelect
  });

  const result = new Map<number, QuranWordRef[]>();
  for (const pageNumber of uniquePageNumbers) {
    const verseIds = verseIdsByPage.get(pageNumber) ?? new Set<number>();
    result.set(
      pageNumber,
      fullVerseWords.filter((word) => verseIds.has(word.verseId)).map(toWordRef)
    );
  }
  return result;
}

async function wordsForExtension(
  tx: Prisma.TransactionClient,
  verseId: number
) {
  return tx.quranWord.findMany({
    where: { verseId, charTypeName: "word" },
    orderBy: { position: "asc" },
    select: extensionWordSelect
  });
}

function toWordRef(word: QuranWordWithVerse): QuranWordRef {
  return {
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
  };
}

async function createHintEvent(
  tx: Prisma.TransactionClient,
  userId: string,
  questionId: string,
  type: HintType,
  ordinal: number,
  payload: PublicHint
) {
  await tx.hintEvent.create({
    data: { userId, questionId, type, ordinal, payload },
    select: { id: true }
  });
}

function hintMutationResult(
  question: HintQuestion,
  hintCounts: HintCounts,
  hint: PublicHint,
  fragmentText?: string
) {
  return {
    questionId: question.id,
    hint,
    availableHints: availableHintsFromCounts(question, hintCounts),
    hintCounts,
    ...(fragmentText ? { fragmentText } : {})
  } satisfies HintMutationResult;
}

function availableHintsFromCounts(
  question: { maxExtensionCount: number; maxNextVerseCount: number },
  counts: HintCounts
) {
  return {
    juz: counts.JUZ < 1,
    surah: counts.SURAH < 1,
    extendFragment: counts.EXTEND_FRAGMENT < question.maxExtensionCount,
    nextVerse: counts.NEXT_VERSE < question.maxNextVerseCount
  };
}

function hintCountsFromEvents(events: readonly { type: HintType }[]) {
  const counts = emptyHintCounts();
  for (const event of events) counts[event.type] += 1;
  return counts;
}

function emptyHintCounts(): HintCounts {
  return {
    JUZ: 0,
    SURAH: 0,
    EXTEND_FRAGMENT: 0,
    NEXT_VERSE: 0
  };
}

function incrementHintCount(counts: HintCounts, type: HintType) {
  return { ...counts, [type]: counts[type] + 1 };
}

function publicHintFromPayload(payload: Prisma.JsonValue) {
  return payload as unknown as PublicHint;
}

async function completePackageIfReady(
  tx: Prisma.TransactionClient,
  packageId: string
) {
  const [questionCount, assessedCount] = await Promise.all([
    tx.memorizationQuestion.count({ where: { packageId } }),
    tx.memorizationQuestion.count({
      where: {
        packageId,
        assessment: { isNot: null }
      }
    })
  ]);
  if (
    questionCount !== productConfig.questionsPerPackage ||
    assessedCount !== questionCount
  )
    return false;

  const pkg = await tx.memorizationPackage.findUniqueOrThrow({
    where: { id: packageId },
    select: { state: true, cycleId: true, packageNumber: true }
  });
  if (pkg.state === "COMPLETED") return true;

  await tx.memorizationPackage.update({
    where: { id: packageId },
    data: { state: "COMPLETED", completedAt: new Date() },
    select: { id: true }
  });

  if (pkg.packageNumber === productConfig.packagesPerCycle) {
    const inProgressPackages = await tx.memorizationPackage.count({
      where: { cycleId: pkg.cycleId, state: "IN_PROGRESS" }
    });
    if (inProgressPackages === 0) {
      await tx.memorizationCycle.update({
        where: { id: pkg.cycleId },
        data: { state: "COMPLETED", completedAt: new Date() },
        select: { id: true }
      });
    }
  }

  return true;
}

async function retrySerialization<T>(
  fn: () => Promise<T>,
  attempts = 8
): Promise<T> {
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
    return (
      maybe.cause?.originalCode === "40001" ||
      maybe.name === "DriverAdapterError"
    );
  }
  return false;
}

type QuestionForPublicDto = Prisma.MemorizationQuestionGetPayload<{
  select: typeof publicQuestionSelect;
}>;

type PackageForDto = Prisma.MemorizationPackageGetPayload<{
  select: typeof packageDtoSelect;
}>;

type CycleForAllocation = Prisma.MemorizationCycleGetPayload<{
  select: typeof cycleForAllocationSelect;
}>;

type HintQuestion = Prisma.MemorizationQuestionGetPayload<{
  select: typeof hintQuestionSelect;
}>;

type QuranWordWithVerse = Prisma.QuranWordGetPayload<{
  select: typeof quranWordRefSelect;
}>;

type GeneratedQuestionRow = Prisma.MemorizationQuestionCreateManyInput & {
  id: string;
  orderInPackage: number;
  visibleFragmentText: string;
  maxExtensionCount: number;
  maxNextVerseCount: number;
};
