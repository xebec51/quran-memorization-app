"use client";

import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Eye,
  Lightbulb,
  MapPinned,
  BookMarked,
  StepForward,
  CheckCircle2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { productConfig } from "@/lib/config";

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
  assessment: "CORRECT" | "PARTIAL" | "MISSED" | null;
};

type PackageDto = {
  id: string;
  packageNumber: number;
  state: string;
  cycle: { cycleNumber: number; state: string; pagesTested: number };
  questions: Question[];
};

type HintLine = { questionId: string; type: string; text: string };
type PendingAction =
  "package" | "reveal" | "assessment" | `hint:${string}` | null;
type Assessment = "CORRECT" | "PARTIAL" | "MISSED";

const panelMotion = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.18 }
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
  const [loading, setLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [error, setError] = useState<string | null>(null);
  const actionLockRef = useRef(false);

  const question = pkg?.questions[activeIndex] ?? null;
  const questionHints = useMemo(
    () => hints.filter((hint) => hint.questionId === question?.id),
    [hints, question?.id]
  );
  const isBusy = loading || pendingAction !== null;

  async function api<T>(url: string, body?: unknown): Promise<T> {
    const response = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
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
    if (!beginAction("package")) return;
    setLoading(true);
    try {
      const data = await api<PackageDto>("/api/memorization/next-package", {});
      setPkg(data);
      setActiveIndex(0);
      setAnswer(null);
      setAssessmentOpen(false);
      setHints([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat paket.");
    } finally {
      setLoading(false);
      endAction();
    }
  }

  async function requestHint(type: string) {
    if (!question || !beginAction(`hint:${type}`)) return;
    try {
      const data = await api<{
        hint: { type: string; text: string };
        question: Question;
      }>("/api/memorization/hint", {
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
      setPkg(
        (current) =>
          current && {
            ...current,
            questions: current.questions.map((item) =>
              item.id === question.id ? data.question : item
            )
          }
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal membuka jawaban.");
    } finally {
      endAction();
    }
  }

  async function assess(assessment: Assessment) {
    if (!question || !beginAction("assessment")) return;
    try {
      const data = await api<PackageDto>("/api/memorization/assessment", {
        questionId: question.id,
        assessment
      });
      setPkg(data);
      setAnswer(null);
      setAssessmentOpen(false);
      if (activeIndex < data.questions.length - 1)
        setActiveIndex(activeIndex + 1);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Gagal menyimpan evaluasi."
      );
    } finally {
      endAction();
    }
  }

  function openAssessment() {
    if (!question || actionLockRef.current || isBusy) return;
    setAnswer(null);
    setAssessmentOpen(true);
  }

  if (loading) return <Card>Memuat latihan...</Card>;
  if (error) {
    return (
      <Card>
        <p className="text-[var(--danger)]">{error}</p>
        <Button className="mt-4" onClick={loadPackage}>
          Coba lagi
        </Button>
      </Card>
    );
  }
  if (!pkg || !question) {
    return (
      <Card className="grid gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Latihan Expert</h1>
          <p className="mt-1 text-[var(--muted)]">{productConfig.tagline}</p>
        </div>
        <Button onClick={loadPackage}>Mulai latihan</Button>
      </Card>
    );
  }

  const assessedCount = pkg.questions.filter((item) => item.assessment).length;
  const packageComplete =
    pkg.state === "COMPLETED" || assessedCount === pkg.questions.length;
  const questionComplete = question.assessment !== null;
  const canUseQuestionActions =
    !isBusy && !questionComplete && !packageComplete;

  if (packageComplete) {
    return (
      <motion.div
        className="grid gap-4 pb-24"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-[var(--muted)]">
              Siklus {pkg.cycle.cycleNumber} - Paket {pkg.packageNumber}
            </p>
            <h1 className="text-2xl font-semibold">Latihan Expert</h1>
          </div>
          <div className="rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm">
            {pkg.cycle.pagesTested}/604 halaman
          </div>
        </div>

        <Card className="grid gap-4">
          <div>
            <h2 className="text-xl font-semibold">Paket selesai</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {assessedCount}/{pkg.questions.length} soal sudah dievaluasi.
            </p>
          </div>
          <Button onClick={loadPackage} disabled={isBusy}>
            {pendingAction === "package" ? "Memuat..." : "Paket berikutnya"}
          </Button>
        </Card>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="grid gap-4 pb-24"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-[var(--muted)]">
            Siklus {pkg.cycle.cycleNumber} · Paket {pkg.packageNumber}
          </p>
          <h1 className="text-2xl font-semibold">Latihan Expert</h1>
        </div>
        <div className="rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm">
          {pkg.cycle.pagesTested}/604 halaman
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2" aria-label="Pertanyaan">
        {pkg.questions.map((item, index) => (
          <button
            key={item.id}
            disabled={isBusy}
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

      <Card className="grid gap-5">
        <AnimatePresence mode="wait">
          <motion.div
            key={question.id}
            {...panelMotion}
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
          </motion.div>
        </AnimatePresence>
        {questionComplete ? (
          <motion.div
            {...panelMotion}
            className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"
          >
            Soal ini sudah dievaluasi: {assessmentLabel(question.assessment)}
          </motion.div>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-4">
          <Button
            variant="secondary"
            disabled={!canUseQuestionActions || !question.availableHints.juz}
            onClick={() => requestHint("JUZ")}
          >
            <MapPinned aria-hidden className="h-4 w-4" /> Juz
          </Button>
          <Button
            variant="secondary"
            disabled={!canUseQuestionActions || !question.availableHints.surah}
            onClick={() => requestHint("SURAH")}
          >
            <BookMarked aria-hidden className="h-4 w-4" /> Surah
          </Button>
          <Button
            variant="secondary"
            disabled={
              !canUseQuestionActions || !question.availableHints.extendFragment
            }
            onClick={() => requestHint("EXTEND_FRAGMENT")}
          >
            <Lightbulb aria-hidden className="h-4 w-4" /> Tambah
          </Button>
          <Button
            variant="secondary"
            disabled={
              !canUseQuestionActions || !question.availableHints.nextVerse
            }
            onClick={() => requestHint("NEXT_VERSE")}
          >
            <StepForward aria-hidden className="h-4 w-4" /> Ayat
          </Button>
        </div>
        <AnimatePresence initial={false}>
          {questionHints.length ? (
            <motion.div
              key={`${question.id}-hints`}
              {...panelMotion}
              className="grid gap-2"
            >
              {questionHints.map((hint, index) => (
                <div
                  key={`${hint.type}-${index}`}
                  className="rounded-md bg-slate-50 p-3 text-sm"
                >
                  <span className="font-medium">{hintLabel(hint.type)}: </span>
                  <span
                    className={
                      hint.type === "EXTEND_FRAGMENT" ||
                      hint.type === "NEXT_VERSE"
                        ? "quran-text text-xl"
                        : ""
                    }
                    translate={
                      hint.type === "EXTEND_FRAGMENT" ||
                      hint.type === "NEXT_VERSE"
                        ? "no"
                        : undefined
                    }
                    dir={
                      hint.type === "EXTEND_FRAGMENT" ||
                      hint.type === "NEXT_VERSE"
                        ? "rtl"
                        : undefined
                    }
                  >
                    {hint.text}
                  </span>
                </div>
              ))}
            </motion.div>
          ) : null}
        </AnimatePresence>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button onClick={reveal} disabled={!canUseQuestionActions}>
            <Eye aria-hidden className="h-4 w-4" />{" "}
            {pendingAction === "reveal" ? "Membuka..." : "Lihat Jawaban"}
          </Button>
          <Button
            variant="secondary"
            onClick={openAssessment}
            disabled={!canUseQuestionActions}
          >
            <StepForward aria-hidden className="h-4 w-4" /> Soal selesai dijawab
          </Button>
        </div>
        <AnimatePresence mode="wait">
          {assessmentOpen ? (
            <motion.div
              key="assessment"
              {...panelMotion}
              className="grid gap-3 rounded-md border border-[var(--border)] p-4"
            >
              <p className="text-sm font-medium">Evaluasi jawaban</p>
              <AssessmentButtons onAssess={assess} disabled={isBusy} />
            </motion.div>
          ) : null}
          {answer ? (
            <motion.div
              key="answer"
              {...panelMotion}
              className="grid gap-3 rounded-md border border-[var(--border)] p-4"
            >
              <p className="text-sm text-[var(--muted)]">
                {answer.surah} · {answer.verseKey} · Juz {answer.juz} · Halaman{" "}
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
              <AssessmentButtons onAssess={assess} disabled={isBusy} />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </Card>
    </motion.div>
  );
}

function AssessmentButtons({
  onAssess,
  disabled
}: {
  onAssess: (assessment: Assessment) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      <Button onClick={() => onAssess("CORRECT")} disabled={disabled}>
        <CheckCircle2 aria-hidden className="h-4 w-4" /> Benar
      </Button>
      <Button
        variant="secondary"
        onClick={() => onAssess("PARTIAL")}
        disabled={disabled}
      >
        Sebagian benar
      </Button>
      <Button
        variant="danger"
        onClick={() => onAssess("MISSED")}
        disabled={disabled}
      >
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
