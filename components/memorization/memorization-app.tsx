"use client";

import { useMemo, useRef, useState } from "react";
import {
  BookMarked,
  CheckCircle2,
  Eye,
  Lightbulb,
  MapPinned,
  Search,
  StepForward
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { productConfig } from "@/lib/config";

type Assessment = "CORRECT" | "PARTIAL" | "MISSED";

type Question = {
  id: string;
  order: number;
  totalQuestions: number;
  fragmentText: string;
  availableHints: {
    juz: boolean;
    surah: boolean;
    extendFragment: boolean;
    nextVerse: boolean;
  };
  answerRevealed: boolean;
  assessment: Assessment | null;
};

type PackageDto = {
  id: string;
  packageNumber: number;
  state: string;
  cycle: { cycleNumber: number; state: string; pagesTested: number };
  questions: Question[];
};

type HintLine = { questionId: string; type: string; text: string };
type PendingAction = "package" | "reveal" | `hint:${string}` | null;

type HintMutation = {
  questionId: string;
  hint: { type: string; text: string };
  availableHints: Question["availableHints"];
  fragmentText?: string;
};

type AssessmentMutation = {
  questionId: string;
  assessment: Assessment;
  packageCompleted: boolean;
};

export function MemorizationApp({
  initialPackage = null
}: {
  initialPackage?: PackageDto | null;
}) {
  const [pkg, setPkg] = useState<PackageDto | null>(initialPackage);
  const [activeIndex, setActiveIndex] = useState(0);
  const [hints, setHints] = useState<HintLine[]>([]);
  const [answer, setAnswer] = useState<null | {
    surah: string;
    verseKey: string;
    juz: number;
    page: number;
    text: string;
    continuation: string[];
  }>(null);
  const [assessmentOpen, setAssessmentOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [pendingAssessments, setPendingAssessments] = useState<
    Record<string, Assessment>
  >({});
  const [error, setError] = useState<string | null>(null);
  const actionLockRef = useRef(false);
  const inFlightAssessmentsRef = useRef(new Set<string>());

  const question = pkg?.questions[activeIndex] ?? null;
  const questionHints = useMemo(
    () => hints.filter((hint) => hint.questionId === question?.id),
    [hints, question?.id]
  );
  const pendingAssessmentCount = Object.keys(pendingAssessments).length;
  const packageComplete = Boolean(
    pkg &&
    (pkg.state === "COMPLETED" ||
      pkg.questions.every((item) => item.assessment))
  );
  const questionComplete = question?.assessment !== null;
  const questionActionsBusy = pendingAction !== null;
  const canUseQuestionActions = Boolean(
    question && !questionActionsBusy && !questionComplete && !packageComplete
  );

  async function api<T>(
    url: string,
    body?: unknown,
    options: { keepalive?: boolean } = {}
  ): Promise<T> {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
      keepalive: options.keepalive
    });
    const json = (await response.json()) as {
      data?: T;
      error?: { message: string };
    };
    if (!response.ok || !json.data)
      throw new Error(json.error?.message ?? "Permintaan gagal.");
    return json.data;
  }

  function beginAction(action: Exclude<PendingAction, null>) {
    if (actionLockRef.current) return false;
    actionLockRef.current = true;
    setPendingAction(action);
    setError(null);
    return true;
  }

  function endAction() {
    actionLockRef.current = false;
    setPendingAction(null);
  }

  async function loadPackage() {
    if (pendingAssessmentCount > 0 || !beginAction("package")) return;
    try {
      const data = await api<PackageDto>("/api/memorization/next-package");
      setPkg(data);
      setActiveIndex(0);
      setAnswer(null);
      setAssessmentOpen(false);
      setHints([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat paket.");
    } finally {
      endAction();
    }
  }

  async function requestHint(type: string) {
    if (!question || !beginAction(`hint:${type}`)) return;
    try {
      const data = await api<HintMutation>("/api/memorization/hint", {
        questionId: question.id,
        type
      });
      setHints((current) => [
        ...current.filter(
          (hint) =>
            !(
              hint.questionId === question.id &&
              hint.type === data.hint.type &&
              data.hint.type !== "EXTEND_FRAGMENT" &&
              data.hint.type !== "NEXT_VERSE"
            )
        ),
        { questionId: question.id, type: data.hint.type, text: data.hint.text }
      ]);
      setPkg((current) =>
        current
          ? {
              ...current,
              questions: current.questions.map((item) =>
                item.id === data.questionId
                  ? {
                      ...item,
                      availableHints: data.availableHints,
                      fragmentText: data.fragmentText ?? item.fragmentText
                    }
                  : item
              )
            }
          : current
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal meminta petunjuk.");
    } finally {
      endAction();
    }
  }

  async function reveal() {
    if (!question || !beginAction("reveal")) return;
    try {
      const data = await api<{
        surah: string;
        verseKey: string;
        juz: number;
        page: number;
        text: string;
        continuation: string[];
      }>("/api/memorization/reveal", { questionId: question.id });
      setAnswer(data);
      setAssessmentOpen(false);
      setPkg((current) =>
        current
          ? {
              ...current,
              questions: current.questions.map((item) =>
                item.id === question.id
                  ? { ...item, answerRevealed: true }
                  : item
              )
            }
          : current
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal membuka jawaban.");
    } finally {
      endAction();
    }
  }

  async function assess(assessment: Assessment) {
    if (!pkg || !question || inFlightAssessmentsRef.current.has(question.id))
      return;

    const assessedQuestion = question;
    const previousPackage = pkg;
    const previousIndex = activeIndex;
    const previousAnswer = answer;
    const previousAssessmentOpen = assessmentOpen;
    const nextQuestions = pkg.questions.map((item) =>
      item.id === assessedQuestion.id ? { ...item, assessment } : item
    );
    const nextPackageCompleted = nextQuestions.every((item) => item.assessment);

    inFlightAssessmentsRef.current.add(assessedQuestion.id);
    setPendingAssessments((current) => ({
      ...current,
      [assessedQuestion.id]: assessment
    }));
    setError(null);
    setPkg({
      ...pkg,
      state: nextPackageCompleted ? "COMPLETED" : pkg.state,
      questions: nextQuestions
    });
    setAnswer(null);
    setAssessmentOpen(false);
    if (!nextPackageCompleted && activeIndex < pkg.questions.length - 1)
      setActiveIndex(activeIndex + 1);

    try {
      const data = await api<AssessmentMutation>(
        "/api/memorization/assessment",
        {
          questionId: assessedQuestion.id,
          assessment
        },
        { keepalive: true }
      );
      setPkg((current) =>
        current
          ? {
              ...current,
              state: data.packageCompleted ? "COMPLETED" : current.state,
              questions: current.questions.map((item) =>
                item.id === data.questionId
                  ? { ...item, assessment: data.assessment }
                  : item
              )
            }
          : current
      );
    } catch (err) {
      setPkg(previousPackage);
      setActiveIndex(previousIndex);
      setAnswer(previousAnswer);
      setAssessmentOpen(previousAssessmentOpen || true);
      setError(
        err instanceof Error
          ? `Evaluasi belum tersimpan: ${err.message}`
          : "Evaluasi belum tersimpan. Coba lagi."
      );
    } finally {
      inFlightAssessmentsRef.current.delete(assessedQuestion.id);
      setPendingAssessments((current) => {
        const rest = { ...current };
        delete rest[assessedQuestion.id];
        return rest;
      });
    }
  }

  function openAssessment() {
    if (!canUseQuestionActions) return;
    setAnswer(null);
    setAssessmentOpen(true);
  }

  if (!pkg || !question) {
    return (
      <Card className="grid gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Latihan Expert</h1>
          <p className="mt-1 text-[var(--muted)]">{productConfig.tagline}</p>
        </div>
        {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
        <Button onClick={loadPackage} disabled={pendingAction === "package"}>
          {pendingAction === "package" ? "Memuat..." : "Mulai latihan"}
        </Button>
      </Card>
    );
  }

  const assessedCount = pkg.questions.filter((item) => item.assessment).length;

  if (packageComplete) {
    return (
      <div className="grid gap-4 pb-24">
        <MemorizationHeader
          pkg={pkg}
          pendingAssessmentCount={pendingAssessmentCount}
        />
        {error ? (
          <Card className="text-sm text-[var(--danger)]">{error}</Card>
        ) : null}
        <Card className="grid gap-4 tasmiq-panel-enter">
          <div>
            <h2 className="text-xl font-semibold">Paket selesai</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {assessedCount}/{pkg.questions.length} soal sudah dievaluasi.
            </p>
          </div>
          <Button
            onClick={loadPackage}
            disabled={pendingAction === "package" || pendingAssessmentCount > 0}
          >
            {pendingAction === "package" ? "Memuat..." : "Paket berikutnya"}
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid gap-4 pb-24">
      <MemorizationHeader
        pkg={pkg}
        pendingAssessmentCount={pendingAssessmentCount}
      />
      <div className="grid grid-cols-4 gap-2" aria-label="Pertanyaan">
        {pkg.questions.map((item, index) => (
          <button
            key={item.id}
            disabled={questionActionsBusy}
            onClick={() => {
              setActiveIndex(index);
              setAnswer(null);
              setAssessmentOpen(false);
            }}
            className={`rounded-md border px-3 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-55 ${
              index === activeIndex
                ? "border-[var(--primary)] bg-emerald-50"
                : item.assessment
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                  : "border-[var(--border)] bg-white"
            }`}
          >
            {item.order}
          </button>
        ))}
      </div>
      {error ? (
        <Card className="text-sm text-[var(--danger)]">{error}</Card>
      ) : null}
      <Card className="grid gap-5">
        <QuestionPanel
          key={question.id}
          question={question}
          questionHints={questionHints}
          answer={answer}
          assessmentOpen={assessmentOpen}
          pendingAction={pendingAction}
          canUseQuestionActions={canUseQuestionActions}
          pendingAssessment={pendingAssessments[question.id] ?? null}
          onHint={requestHint}
          onReveal={reveal}
          onOpenAssessment={openAssessment}
          onAssess={assess}
        />
      </Card>
    </div>
  );
}

function MemorizationHeader({
  pkg,
  pendingAssessmentCount
}: {
  pkg: PackageDto;
  pendingAssessmentCount: number;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-sm font-medium text-[var(--muted)]">
          Siklus {pkg.cycle.cycleNumber} - Paket {pkg.packageNumber}
        </p>
        <h1 className="text-2xl font-semibold">Latihan Expert</h1>
        {pendingAssessmentCount > 0 ? (
          <p className="mt-1 text-sm text-[var(--muted)]">
            Menyimpan evaluasi...
          </p>
        ) : null}
      </div>
      <div className="rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm">
        {pkg.cycle.pagesTested}/604 halaman
      </div>
    </div>
  );
}

function QuestionPanel({
  question,
  questionHints,
  answer,
  assessmentOpen,
  pendingAction,
  canUseQuestionActions,
  pendingAssessment,
  onHint,
  onReveal,
  onOpenAssessment,
  onAssess
}: {
  question: Question;
  questionHints: HintLine[];
  answer: {
    surah: string;
    verseKey: string;
    juz: number;
    page: number;
    text: string;
    continuation: string[];
  } | null;
  assessmentOpen: boolean;
  pendingAction: PendingAction;
  canUseQuestionActions: boolean;
  pendingAssessment: Assessment | null;
  onHint: (type: string) => void;
  onReveal: () => void;
  onOpenAssessment: () => void;
  onAssess: (assessment: Assessment) => void;
}) {
  const questionComplete = question.assessment !== null;
  return (
    <div className="grid gap-5 tasmiq-panel-enter">
      <div
        className="quran-text min-h-44 rounded-md bg-[#fbfaf4] p-5 text-right text-4xl leading-loose md:text-5xl"
        translate="no"
        lang="ar"
        dir="rtl"
      >
        {question.fragmentText}
        <span aria-hidden className="text-[var(--accent)]">
          {" "}
          ...
        </span>
      </div>
      {questionComplete ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          Soal ini sudah dievaluasi: {assessmentLabel(question.assessment)}
        </div>
      ) : null}
      {pendingAssessment ? (
        <div className="rounded-md bg-slate-50 p-3 text-sm text-[var(--muted)]">
          Menyimpan: {assessmentLabel(pendingAssessment)}
        </div>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-4">
        <Button
          variant="secondary"
          disabled={!canUseQuestionActions || !question.availableHints.juz}
          onClick={() => onHint("JUZ")}
        >
          <MapPinned aria-hidden className="h-4 w-4" /> Juz
        </Button>
        <Button
          variant="secondary"
          disabled={!canUseQuestionActions || !question.availableHints.surah}
          onClick={() => onHint("SURAH")}
        >
          <BookMarked aria-hidden className="h-4 w-4" /> Surah
        </Button>
        <Button
          variant="secondary"
          disabled={
            !canUseQuestionActions || !question.availableHints.extendFragment
          }
          onClick={() => onHint("EXTEND_FRAGMENT")}
        >
          <Lightbulb aria-hidden className="h-4 w-4" /> Tambah
        </Button>
        <Button
          variant="secondary"
          disabled={
            !canUseQuestionActions || !question.availableHints.nextVerse
          }
          onClick={() => onHint("NEXT_VERSE")}
        >
          <StepForward aria-hidden className="h-4 w-4" /> Ayat
        </Button>
      </div>
      {questionHints.length ? (
        <div className="grid gap-2 tasmiq-panel-enter">
          {questionHints.map((hint, index) => (
            <div
              key={`${hint.type}-${index}`}
              className="rounded-md bg-slate-50 p-3 text-sm"
            >
              <span className="font-medium">{hintLabel(hint.type)}: </span>
              <span
                className={
                  hint.type === "EXTEND_FRAGMENT" || hint.type === "NEXT_VERSE"
                    ? "quran-text text-xl"
                    : ""
                }
                translate={
                  hint.type === "EXTEND_FRAGMENT" || hint.type === "NEXT_VERSE"
                    ? "no"
                    : undefined
                }
                dir={
                  hint.type === "EXTEND_FRAGMENT" || hint.type === "NEXT_VERSE"
                    ? "rtl"
                    : undefined
                }
              >
                {hint.text}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <Button onClick={onReveal} disabled={!canUseQuestionActions}>
          <Eye aria-hidden className="h-4 w-4" />{" "}
          {pendingAction === "reveal" ? "Membuka..." : "Lihat Jawaban"}
        </Button>
        <Button
          variant="secondary"
          onClick={onOpenAssessment}
          disabled={!canUseQuestionActions}
        >
          <Search aria-hidden className="h-4 w-4" /> Soal selesai dijawab
        </Button>
      </div>
      {assessmentOpen ? (
        <div className="grid gap-3 rounded-md border border-[var(--border)] p-4 tasmiq-panel-enter">
          <p className="text-sm font-medium">Evaluasi jawaban</p>
          <AssessmentButtons onAssess={onAssess} />
        </div>
      ) : null}
      {answer ? (
        <div className="grid gap-3 rounded-md border border-[var(--border)] p-4 tasmiq-panel-enter">
          <p className="text-sm text-[var(--muted)]">
            {answer.surah} - {answer.verseKey} - Juz {answer.juz} - Halaman{" "}
            {answer.page}
          </p>
          <p
            className="quran-text text-right text-3xl"
            translate="no"
            lang="ar"
            dir="rtl"
          >
            {answer.text}
          </p>
          {answer.continuation.map((line, index) => (
            <p
              key={index}
              className="quran-text text-right text-2xl text-[var(--muted)]"
              translate="no"
              lang="ar"
              dir="rtl"
            >
              {line}
            </p>
          ))}
          <AssessmentButtons onAssess={onAssess} />
        </div>
      ) : null}
    </div>
  );
}

function AssessmentButtons({
  onAssess
}: {
  onAssess: (assessment: Assessment) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      <Button onClick={() => onAssess("CORRECT")}>
        <CheckCircle2 aria-hidden className="h-4 w-4" /> Benar
      </Button>
      <Button variant="secondary" onClick={() => onAssess("PARTIAL")}>
        Sebagian benar
      </Button>
      <Button variant="danger" onClick={() => onAssess("MISSED")}>
        Belum ingat
      </Button>
    </div>
  );
}

function hintLabel(type: string) {
  if (type === "JUZ") return "Petunjuk Juz";
  if (type === "SURAH") return "Petunjuk Surah";
  if (type === "EXTEND_FRAGMENT") return "Fragmen";
  return "Ayat berikutnya";
}

function assessmentLabel(assessment: Assessment | null) {
  if (assessment === "CORRECT") return "Benar";
  if (assessment === "PARTIAL") return "Sebagian benar";
  return "Belum ingat";
}
