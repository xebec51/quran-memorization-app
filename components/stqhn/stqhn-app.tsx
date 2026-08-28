"use client";

import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Eye,
  FastForward,
  History,
  ListChecks,
  Trophy,
  Video
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { apiFetch } from "@/lib/client/api";
import { AssessmentForm } from "@/components/memorization/assessment-form";

type Assessment = "CORRECT" | "PARTIAL" | "MISSED";
type CompetitionBranch = "HIFZH_30_JUZ_INDEPENDENT" | "TAFSIR_ARABIC";

type BankItem = {
  stqhnQuestionId: string;
  questionCode: string;
  competitionBranch: CompetitionBranch;
  competitionDay: number;
  fragmentText: string;
  status: "NOT_ATTEMPTED" | "IN_PROGRESS" | Assessment;
  lastAttemptAt: string | null;
};

type BankPage = { items: BankItem[]; nextCursor: string | null };

type RevealedAyah = {
  verseKey: string;
  text: string;
  surah: string;
  juz: number;
  page: number;
};

type QuestionDto = {
  questionId: string;
  stqhnQuestionId: string;
  fragmentText: string;
  reveal: {
    revealedAyahCount: number;
    totalAyahCount: number;
    isComplete: boolean;
    verses: RevealedAyah[];
  };
  assessment: Assessment | null;
};

type HistoryItem = {
  questionId: string;
  stqhnQuestionId: string;
  questionCode: string;
  competitionBranch: CompetitionBranch;
  competitionDay: number;
  passageRange: string;
  assessment: Assessment;
  belCount: number;
  tuntunCount: number;
  fragmentText: string;
  revealedVerses: RevealedAyah[];
  sourceVideoUrl: string;
  assessedAt: string;
};

type HistoryPage = { items: HistoryItem[]; nextCursor: string | null };

type Summary = {
  totalQuestions: number;
  attemptedCount: number;
  correctCount: number;
  missedCount: number;
};

type JustGraded = {
  assessment: Assessment;
  belCount: number;
  tuntunCount: number;
};

export function StqhnApp({
  initialBank,
  initialHistory,
  initialSummary
}: {
  initialBank: BankPage;
  initialHistory: HistoryPage;
  initialSummary: Summary;
}) {
  const [bank, setBank] = useState(initialBank);
  const [history, setHistory] = useState(initialHistory);
  const [summary, setSummary] = useState(initialSummary);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [question, setQuestion] = useState<QuestionDto | null>(null);
  const [justGraded, setJustGraded] = useState<JustGraded | null>(null);
  const [questionLoading, setQuestionLoading] = useState(false);
  const [revealPending, setRevealPending] = useState(false);
  const [revealAllPending, setRevealAllPending] = useState(false);
  const [submitPending, setSubmitPending] = useState(false);
  const [loadingMoreBank, setLoadingMoreBank] = useState(false);
  const [loadingMoreHistory, setLoadingMoreHistory] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [questionError, setQuestionError] = useState<string | null>(null);
  const revealLockRef = useRef(false);
  const revealAllLockRef = useRef(false);
  const submitLockRef = useRef(false);
  const gradedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards against a response for a question the user has since navigated
  // away from overwriting whatever they're now looking at - same pattern
  // as components/evaluation/evaluation-app.tsx's activeQuestionIdRef.
  const activeQuestionIdRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (gradedTimeoutRef.current) clearTimeout(gradedTimeoutRef.current);
    };
  }, []);

  async function selectQuestion(item: BankItem) {
    if (gradedTimeoutRef.current) {
      clearTimeout(gradedTimeoutRef.current);
      gradedTimeoutRef.current = null;
    }
    activeQuestionIdRef.current = item.stqhnQuestionId;
    revealLockRef.current = false;
    revealAllLockRef.current = false;
    submitLockRef.current = false;
    setRevealPending(false);
    setRevealAllPending(false);
    setSubmitPending(false);
    setSelectedId(item.stqhnQuestionId);
    setQuestion(null);
    setJustGraded(null);
    setListError(null);
    setQuestionError(null);
    setQuestionLoading(true);
    try {
      const data = await apiFetch<QuestionDto>("/api/stqhn/start", {
        stqhnQuestionId: item.stqhnQuestionId
      });
      if (activeQuestionIdRef.current !== item.stqhnQuestionId) return;
      setQuestion(data);
      // /api/stqhn/start creates the underlying MemorizationQuestion row
      // on first selection (getOrCreateStqhnAttempt), which is also the
      // moment the server's own getStqhnSummary starts counting this
      // question as attempted - reflect that locally now rather than
      // leaving "Sudah dicoba" and this item's badge stale until a full
      // reload, for however long the user reveals/thinks before grading.
      if (item.status === "NOT_ATTEMPTED") {
        setBank((current) => ({
          ...current,
          items: current.items.map((bankItem) =>
            bankItem.stqhnQuestionId === item.stqhnQuestionId
              ? { ...bankItem, status: "IN_PROGRESS" }
              : bankItem
          )
        }));
        setSummary((current) => ({
          ...current,
          attemptedCount: current.attemptedCount + 1
        }));
      }
    } catch (err) {
      if (activeQuestionIdRef.current !== item.stqhnQuestionId) return;
      setListError(
        err instanceof Error ? err.message : "Gagal memuat soal STQHN."
      );
      setSelectedId(null);
    } finally {
      if (activeQuestionIdRef.current === item.stqhnQuestionId) {
        setQuestionLoading(false);
      }
    }
  }

  async function revealNext() {
    if (!question || revealLockRef.current || question.reveal.isComplete)
      return;
    const stqhnQuestionId = question.stqhnQuestionId;
    revealLockRef.current = true;
    setRevealPending(true);
    setQuestionError(null);
    try {
      const data = await apiFetch<{
        questionId: string;
        revealedAyahCount: number;
        totalAyahCount: number;
        isComplete: boolean;
        verses: RevealedAyah[];
      }>("/api/memorization/reveal", {
        questionId: question.questionId,
        expectedRevealedCount: question.reveal.revealedAyahCount
      });
      if (activeQuestionIdRef.current !== stqhnQuestionId) return;
      setQuestion((current) =>
        current ? { ...current, reveal: data } : current
      );
    } catch (err) {
      if (activeQuestionIdRef.current !== stqhnQuestionId) return;
      setQuestionError(
        err instanceof Error ? err.message : "Gagal membuka ayat berikutnya."
      );
    } finally {
      revealLockRef.current = false;
      if (activeQuestionIdRef.current === stqhnQuestionId) {
        setRevealPending(false);
      }
    }
  }

  async function revealAll() {
    if (!question || revealAllLockRef.current || question.reveal.isComplete)
      return;
    const stqhnQuestionId = question.stqhnQuestionId;
    revealAllLockRef.current = true;
    setRevealAllPending(true);
    setQuestionError(null);
    try {
      const data = await apiFetch<{
        questionId: string;
        revealedAyahCount: number;
        totalAyahCount: number;
        isComplete: boolean;
        verses: RevealedAyah[];
      }>("/api/memorization/reveal-all", {
        questionId: question.questionId
      });
      if (activeQuestionIdRef.current !== stqhnQuestionId) return;
      setQuestion((current) =>
        current ? { ...current, reveal: data } : current
      );
    } catch (err) {
      if (activeQuestionIdRef.current !== stqhnQuestionId) return;
      setQuestionError(
        err instanceof Error ? err.message : "Gagal membuka seluruh ayat."
      );
    } finally {
      revealAllLockRef.current = false;
      if (activeQuestionIdRef.current === stqhnQuestionId) {
        setRevealAllPending(false);
      }
    }
  }

  async function submitAssessment(belCount: number, tuntunCount: number) {
    if (!question || !question.reveal.isComplete || submitLockRef.current)
      return;
    const stqhnQuestionId = question.stqhnQuestionId;
    submitLockRef.current = true;
    setSubmitPending(true);
    setQuestionError(null);
    try {
      const result = await apiFetch<{
        questionId: string;
        assessment: Assessment;
        belCount: number;
        tuntunCount: number;
      }>("/api/memorization/assessment", {
        questionId: question.questionId,
        belCount,
        tuntunCount
      });
      // Reselecting an already-graded question resumes the same fully-
      // revealed row (getOrCreateStqhnAttempt), so re-submitting the same
      // bel/tuntun pair is a valid, server-side idempotent replay (see
      // submitAssessment in lib/memorization/service.ts) rather than a
      // blocked action - but it must not re-count locally.
      const previousStatus =
        bank.items.find((item) => item.stqhnQuestionId === stqhnQuestionId)
          ?.status ?? "NOT_ATTEMPTED";
      const wasAlreadyAssessed =
        previousStatus === "CORRECT" ||
        previousStatus === "PARTIAL" ||
        previousStatus === "MISSED";
      setBank((current) => ({
        ...current,
        items: current.items.map((item) =>
          item.stqhnQuestionId === stqhnQuestionId
            ? {
                ...item,
                status: result.assessment,
                lastAttemptAt: new Date().toISOString()
              }
            : item
        )
      }));
      setSummary((current) => ({
        ...current,
        correctCount:
          current.correctCount +
          (!wasAlreadyAssessed && result.assessment === "CORRECT" ? 1 : 0),
        missedCount:
          current.missedCount +
          (!wasAlreadyAssessed && result.assessment !== "CORRECT" ? 1 : 0)
      }));
      if (activeQuestionIdRef.current === stqhnQuestionId) {
        setJustGraded({
          assessment: result.assessment,
          belCount: result.belCount,
          tuntunCount: result.tuntunCount
        });
        gradedTimeoutRef.current = setTimeout(() => {
          setSelectedId(null);
          setQuestion(null);
          setJustGraded(null);
        }, 1800);
      }
    } catch (err) {
      if (activeQuestionIdRef.current === stqhnQuestionId) {
        setQuestionError(
          err instanceof Error ? err.message : "Gagal menyimpan evaluasi."
        );
      }
    } finally {
      submitLockRef.current = false;
      if (activeQuestionIdRef.current === stqhnQuestionId) {
        setSubmitPending(false);
      }
    }
  }

  async function loadMoreBank() {
    if (!bank.nextCursor || loadingMoreBank) return;
    setListError(null);
    setLoadingMoreBank(true);
    try {
      const page = await apiFetch<BankPage>(
        `/api/stqhn/bank?cursor=${encodeURIComponent(bank.nextCursor)}&limit=20`,
        undefined,
        { method: "GET" }
      );
      setBank((current) => ({
        items: [...current.items, ...page.items],
        nextCursor: page.nextCursor
      }));
    } catch (err) {
      setListError(
        err instanceof Error ? err.message : "Gagal memuat bank soal STQHN."
      );
    } finally {
      setLoadingMoreBank(false);
    }
  }

  async function loadMoreHistory() {
    if (!history.nextCursor || loadingMoreHistory) return;
    setListError(null);
    setLoadingMoreHistory(true);
    try {
      const page = await apiFetch<HistoryPage>(
        `/api/stqhn/history?cursor=${encodeURIComponent(history.nextCursor)}&limit=20`,
        undefined,
        { method: "GET" }
      );
      setHistory((current) => ({
        items: [...current.items, ...page.items],
        nextCursor: page.nextCursor
      }));
    } catch (err) {
      setListError(
        err instanceof Error ? err.message : "Gagal memuat riwayat STQHN."
      );
    } finally {
      setLoadingMoreHistory(false);
    }
  }

  const revealButtonLabel = revealPending
    ? "Membuka..."
    : question && question.reveal.revealedAyahCount === 0
      ? "Lihat Ayat Pertama"
      : "Lihat Ayat Berikutnya";

  return (
    <div className="grid gap-4 pb-20">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Trophy aria-hidden className="h-6 w-6 text-[var(--primary)]" />
          STQHN 2025
        </h1>
        <p className="mt-1 text-[var(--muted)]">
          Bank soal hafalan asli dari Seleksi Tilawah Qur&apos;an dan Hafalan
          Nasional 2025 - 372 soal, terpisah dari siklus 604 halaman.
        </p>
      </div>

      <Card>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 sm:divide-x sm:divide-[var(--border)]">
          <Metric
            icon={ListChecks}
            label="Total soal"
            value={summary.totalQuestions}
          />
          <Metric
            icon={Trophy}
            label="Sudah dicoba"
            value={summary.attemptedCount}
            className="sm:pl-4"
          />
          <Metric
            icon={CheckCircle2}
            label="Benar"
            value={summary.correctCount}
            className="sm:pl-4"
          />
          <Metric
            icon={History}
            label="Perlu evaluasi ulang"
            value={summary.missedCount}
            className="sm:pl-4"
          />
        </div>
      </Card>

      {listError ? (
        <Card role="alert" className="text-sm text-[var(--danger)]">
          {listError}
        </Card>
      ) : null}

      <Card>
        <h2 className="font-semibold">Bank Soal STQHN 2025</h2>
        <div className="mt-3 grid gap-2">
          {bank.items.map((item) => (
            <button
              key={item.stqhnQuestionId}
              type="button"
              onClick={() => {
                if (!questionLoading) selectQuestion(item);
              }}
              aria-disabled={questionLoading || undefined}
              aria-label={`Soal ${item.questionCode}: ${statusLabel(item.status)}: ${item.fragmentText}`}
              className={`rounded-md border p-3 text-left text-sm transition ${
                questionLoading ? "pointer-events-none opacity-70" : ""
              } ${
                item.stqhnQuestionId === selectedId
                  ? "border-[var(--primary)] bg-emerald-50"
                  : "border-[var(--border)] bg-white hover:bg-slate-50"
              }`}
            >
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-[var(--muted)]">
                  {item.questionCode} - Hari {item.competitionDay} -{" "}
                  {branchLabel(item.competitionBranch)}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(item.status)}`}
                >
                  {statusLabel(item.status)}
                </span>
              </div>
              <p
                className="quran-text text-right text-xl"
                translate="no"
                lang="ar"
                dir="rtl"
              >
                {item.fragmentText}
              </p>
            </button>
          ))}
        </div>
        {bank.nextCursor ? (
          <Button
            variant="secondary"
            className="mt-3"
            disabled={loadingMoreBank}
            onClick={loadMoreBank}
          >
            {loadingMoreBank ? "Memuat..." : "Muat lebih banyak"}
          </Button>
        ) : null}
      </Card>

      {selectedId && (questionLoading || question) ? (
        <Card className="grid gap-4 border-l-4 border-l-[var(--primary)] tasmiq-panel-enter">
          <div>
            <h2 className="font-semibold">Latihan Soal STQHN</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Ingat ayat berikut dari hafalan, buka satu per satu (atau
              sekaligus) untuk memeriksa, lalu catat hasilnya.
            </p>
          </div>
          {questionError ? (
            <p role="alert" className="text-sm text-[var(--danger)]">
              {questionError}
            </p>
          ) : null}
          {questionLoading || !question ? (
            <p className="text-sm text-[var(--muted)]">Memuat soal...</p>
          ) : justGraded ? (
            <div
              className={`rounded-md border p-4 text-sm ${
                justGraded.assessment === "CORRECT"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                  : "border-amber-200 bg-amber-50 text-amber-900"
              }`}
            >
              <p className="font-medium">
                {justGraded.assessment === "CORRECT"
                  ? "Benar - lulus soal ini."
                  : "Belum ingat - soal ini otomatis masuk ke Evaluasi Latihan untuk dicoba lagi."}
              </p>
              <p className="mt-1 text-xs">
                Bel: {justGraded.belCount} - Tuntun: {justGraded.tuntunCount}
              </p>
            </div>
          ) : (
            <>
              <p
                className="quran-text rounded-md bg-[#fbfaf4] p-4 text-right text-3xl"
                translate="no"
                lang="ar"
                dir="rtl"
              >
                {question.fragmentText}
                <span aria-hidden className="text-[var(--accent)]">
                  {" "}
                  ...
                </span>
              </p>

              {question.reveal.verses.length > 0 ? (
                <div className="grid max-h-[28rem] gap-3 overflow-y-auto rounded-md border border-[var(--border)] tasmiq-panel-enter">
                  <p className="sticky top-0 z-10 border-b border-[var(--border)] bg-[#fbfaf4] px-4 py-2 text-sm text-[var(--muted)]">
                    Ayat {question.reveal.revealedAyahCount}/
                    {question.reveal.totalAyahCount} terbuka
                    {question.reveal.isComplete ? " - halaman ini selesai" : ""}
                  </p>
                  <div className="grid gap-3 p-4 pt-0">
                    {question.reveal.verses.map((verse) => (
                      <div key={verse.verseKey} className="grid gap-1">
                        <p className="text-xs text-[var(--muted)]">
                          {verse.surah} - {verse.verseKey} - Juz {verse.juz} -
                          Halaman {verse.page}
                        </p>
                        <p
                          className="quran-text text-right text-3xl"
                          translate="no"
                          lang="ar"
                          dir="rtl"
                        >
                          {verse.text}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-[var(--muted)]">
                  Ayat {question.reveal.revealedAyahCount}/
                  {question.reveal.totalAyahCount} terbuka
                </p>
              )}

              {!question.reveal.isComplete ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button
                    onClick={revealNext}
                    disabled={revealPending || revealAllPending}
                  >
                    <Eye aria-hidden className="h-4 w-4" /> {revealButtonLabel}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={revealAll}
                    disabled={revealPending || revealAllPending}
                  >
                    <FastForward aria-hidden className="h-4 w-4" />{" "}
                    {revealAllPending
                      ? "Membuka semua ayat..."
                      : "Soal selesai dijawab"}
                  </Button>
                </div>
              ) : (
                <div className="grid gap-3 rounded-md border border-[var(--border)] p-4 tasmiq-panel-enter">
                  <p className="text-sm font-medium">Evaluasi jawaban</p>
                  <AssessmentForm
                    onAssess={submitAssessment}
                    pending={submitPending}
                  />
                </div>
              )}
            </>
          )}
        </Card>
      ) : null}

      <Card>
        <div className="flex items-center gap-2">
          <History aria-hidden className="h-5 w-5 text-[var(--primary)]" />
          <h2 className="font-semibold">Riwayat STQHN 2025</h2>
        </div>
        {history.items.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted)]">
            Belum ada soal STQHN yang dinilai.
          </p>
        ) : (
          <div className="mt-3 grid gap-2">
            {history.items.map((item) => (
              <div
                key={item.questionId}
                className="rounded-md bg-slate-50 p-3 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium text-[var(--muted)]">
                    {item.questionCode} - Hari {item.competitionDay} -{" "}
                    {branchLabel(item.competitionBranch)} - {item.passageRange}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(item.assessment)}`}
                  >
                    {statusLabel(item.assessment)}
                  </span>
                </div>
                <p
                  className="quran-text mt-2 text-right text-base"
                  translate="no"
                  lang="ar"
                  dir="rtl"
                >
                  {item.fragmentText}
                </p>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-[var(--muted)]">
                    Bel: {item.belCount} - Tuntun: {item.tuntunCount} -{" "}
                    {new Date(item.assessedAt).toLocaleString("id-ID")}
                  </p>
                  <a
                    href={item.sourceVideoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-[var(--primary)] hover:underline"
                  >
                    <Video aria-hidden className="h-3.5 w-3.5" />
                    Lihat Video Sumber
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
        {history.nextCursor ? (
          <Button
            variant="secondary"
            className="mt-3"
            disabled={loadingMoreHistory}
            onClick={loadMoreHistory}
          >
            {loadingMoreHistory ? "Memuat..." : "Muat lebih banyak"}
          </Button>
        ) : null}
      </Card>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  className = ""
}: {
  icon: typeof ListChecks;
  label: string;
  value: number;
  className?: string;
}) {
  return (
    <div className={`grid gap-1 ${className}`}>
      <div className="flex items-center gap-2 text-[var(--muted)]">
        <Icon aria-hidden className="h-4 w-4" />
        <p className="text-xs">{label}</p>
      </div>
      <p className="text-xl font-semibold">{value}</p>
    </div>
  );
}

function branchLabel(branch: CompetitionBranch) {
  return branch === "HIFZH_30_JUZ_INDEPENDENT" ? "30 Juz" : "Tafsir Arab";
}

function statusLabel(status: BankItem["status"]) {
  if (status === "NOT_ATTEMPTED") return "Belum dicoba";
  if (status === "IN_PROGRESS") return "Sedang berlangsung";
  if (status === "CORRECT") return "Benar";
  if (status === "PARTIAL") return "Sebagian benar";
  return "Belum ingat";
}

function statusBadgeClass(status: BankItem["status"]) {
  if (status === "CORRECT") return "bg-emerald-100 text-emerald-800";
  if (status === "NOT_ATTEMPTED") return "bg-slate-100 text-slate-700";
  if (status === "IN_PROGRESS") return "bg-sky-100 text-sky-800";
  return "bg-red-100 text-red-800";
}
