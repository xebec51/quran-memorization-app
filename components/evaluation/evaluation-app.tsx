"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlarmClock,
  CheckCircle2,
  Eye,
  FastForward,
  History,
  ListChecks,
  Repeat,
  Shuffle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { apiFetch } from "@/lib/client/api";
import {
  assessmentClassificationLabel,
  formatAssessmentPerformance
} from "@/lib/memorization/assessment";
import {
  AssessmentForm,
  RevealSkeletonRow
} from "@/components/memorization/assessment-form";

type Assessment = "CORRECT" | "PARTIAL" | "MISSED";

type BankItem = {
  questionId: string;
  fragmentText: string;
  lastResult: Assessment;
  lastAttemptAt: string | null;
};

type BankPage = {
  items: BankItem[];
  nextCursor: string | null;
  totalCount: number;
};

type RevealedAyah = {
  verseKey: string;
  text: string;
  surah: string;
  juz: number;
  page: number;
};

type SessionDto = {
  questionId: string;
  fragmentText: string;
  revealedAyahCount: number;
  totalAyahCount: number;
  isComplete: boolean;
  verses: RevealedAyah[];
};

type AttemptDto = {
  id: string;
  questionId: string;
  result: Assessment;
  belCount: number;
  tuntunCount: number;
  createdAt: string;
};

type HistoryItem = AttemptDto & { fragmentText: string };

type HistoryPage = {
  items: HistoryItem[];
  nextCursor: string | null;
};

type Summary = {
  totalAttempts: number;
  totalBelCount: number;
  totalTuntunCount: number;
  resultCounts: Record<Assessment, number>;
};

type JustSaved = { result: Assessment; belCount: number; tuntunCount: number };

export function EvaluationApp({
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
  const [session, setSession] = useState<SessionDto | null>(null);
  const [justSaved, setJustSaved] = useState<JustSaved | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [randomPending, setRandomPending] = useState(false);
  const [revealPending, setRevealPending] = useState(false);
  const [revealAllPending, setRevealAllPending] = useState(false);
  const [submitPending, setSubmitPending] = useState(false);
  const [loadingMoreBank, setLoadingMoreBank] = useState(false);
  const [loadingMoreHistory, setLoadingMoreHistory] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const submitLockRef = useRef(false);
  const revealLockRef = useRef(false);
  const revealAllLockRef = useRef(false);
  const randomLockRef = useRef(false);
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptKeyRef = useRef<string>(crypto.randomUUID());
  const activeQuestionIdRef = useRef<string | null>(null);
  const randomQuestionFocusRef = useRef<HTMLDivElement>(null);
  const randomFocusQuestionIdRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (
      sessionLoading ||
      !session ||
      randomFocusQuestionIdRef.current !== session.questionId
    ) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      const target = randomQuestionFocusRef.current;
      if (!target) return;
      randomFocusQuestionIdRef.current = null;
      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches;
      target.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "start"
      });
      target.focus({ preventScroll: true });
    });

    return () => cancelAnimationFrame(frame);
  }, [session, sessionLoading]);

  async function selectQuestion(item: BankItem) {
    if (savedTimeoutRef.current) {
      clearTimeout(savedTimeoutRef.current);
      savedTimeoutRef.current = null;
    }
    activeQuestionIdRef.current = item.questionId;
    revealLockRef.current = false;
    revealAllLockRef.current = false;
    submitLockRef.current = false;
    setRevealPending(false);
    setRevealAllPending(false);
    setSubmitPending(false);
    setSelectedId(item.questionId);
    setSession(null);
    setJustSaved(null);
    setListError(null);
    setSessionError(null);
    attemptKeyRef.current = crypto.randomUUID();
    setSessionLoading(true);
    try {
      const data = await apiFetch<SessionDto>("/api/evaluation/session", {
        questionId: item.questionId
      });
      if (activeQuestionIdRef.current !== item.questionId) return;
      setSession(data);
    } catch (err) {
      if (activeQuestionIdRef.current !== item.questionId) return;
      if (randomFocusQuestionIdRef.current === item.questionId) {
        randomFocusQuestionIdRef.current = null;
      }
      setListError(
        err instanceof Error ? err.message : "Gagal memuat sesi latihan."
      );
      setSelectedId(null);
    } finally {
      if (activeQuestionIdRef.current === item.questionId) {
        setSessionLoading(false);
      }
    }
  }

  async function selectRandomQuestion() {
    if (randomLockRef.current || sessionLoading || bank.totalCount === 0)
      return;
    randomLockRef.current = true;
    setRandomPending(true);
    setListError(null);
    try {
      const exclude = activeQuestionIdRef.current
        ? `?exclude=${encodeURIComponent(activeQuestionIdRef.current)}`
        : "";
      const item = await apiFetch<BankItem | null>(
        `/api/evaluation/random${exclude}`,
        undefined,
        { method: "GET" }
      );
      if (!item) {
        setListError("Belum ada soal yang dapat diacak di Bank Evaluasi.");
        return;
      }
      // Keep a randomly selected question visible in the bank even when it
      // came from a later cursor page, without disturbing pagination.
      setBank((current) =>
        current.items.some(
          (existing) => existing.questionId === item.questionId
        )
          ? current
          : { ...current, items: [item, ...current.items] }
      );
      randomFocusQuestionIdRef.current = item.questionId;
      await selectQuestion(item);
    } catch (err) {
      setListError(
        err instanceof Error ? err.message : "Gagal mengacak soal evaluasi."
      );
    } finally {
      randomLockRef.current = false;
      setRandomPending(false);
    }
  }

  async function revealNext() {
    if (!session || revealLockRef.current || session.isComplete) return;
    const questionId = session.questionId;
    revealLockRef.current = true;
    setRevealPending(true);
    setSessionError(null);
    try {
      const data = await apiFetch<SessionDto>("/api/evaluation/reveal", {
        questionId,
        expectedRevealedCount: session.revealedAyahCount
      });
      if (activeQuestionIdRef.current !== questionId) return;
      setSession(data);
    } catch (err) {
      if (activeQuestionIdRef.current !== questionId) return;
      setSessionError(
        err instanceof Error ? err.message : "Gagal membuka ayat berikutnya."
      );
    } finally {
      revealLockRef.current = false;
      if (activeQuestionIdRef.current === questionId) setRevealPending(false);
    }
  }

  async function revealAll() {
    if (!session || revealAllLockRef.current || session.isComplete) return;
    const questionId = session.questionId;
    revealAllLockRef.current = true;
    setRevealAllPending(true);
    setSessionError(null);
    try {
      const data = await apiFetch<SessionDto>("/api/evaluation/reveal-all", {
        questionId
      });
      if (activeQuestionIdRef.current !== questionId) return;
      setSession(data);
    } catch (err) {
      if (activeQuestionIdRef.current !== questionId) return;
      setSessionError(
        err instanceof Error ? err.message : "Gagal membuka seluruh ayat."
      );
    } finally {
      revealAllLockRef.current = false;
      if (activeQuestionIdRef.current === questionId) {
        setRevealAllPending(false);
      }
    }
  }

  async function submitAttempt(belCount: number, tuntunCount: number) {
    if (!session || !session.isComplete || submitLockRef.current) return;
    const questionId = session.questionId;
    const fragmentText = session.fragmentText;
    submitLockRef.current = true;
    setSubmitPending(true);
    setSessionError(null);
    try {
      const attempt = await apiFetch<AttemptDto>("/api/evaluation/attempt", {
        questionId,
        belCount,
        tuntunCount,
        clientRequestId: attemptKeyRef.current
      });
      const alreadyRecorded = history.items.some(
        (item) => item.id === attempt.id
      );
      if (!alreadyRecorded) {
        setHistory((current) => ({
          items: [{ ...attempt, fragmentText }, ...current.items],
          nextCursor: current.nextCursor
        }));
        setSummary((current) => ({
          totalAttempts: current.totalAttempts + 1,
          totalBelCount: current.totalBelCount + attempt.belCount,
          totalTuntunCount: current.totalTuntunCount + attempt.tuntunCount,
          resultCounts: {
            ...current.resultCounts,
            [attempt.result]: current.resultCounts[attempt.result] + 1
          }
        }));
        setBank((current) =>
          attempt.result === "CORRECT"
            ? {
                ...current,
                items: current.items.filter(
                  (item) => item.questionId !== questionId
                ),
                totalCount: Math.max(0, current.totalCount - 1)
              }
            : {
                ...current,
                items: current.items.map((item) =>
                  item.questionId === questionId
                    ? { ...item, lastAttemptAt: attempt.createdAt }
                    : item
                )
              }
        );
      }
      if (activeQuestionIdRef.current === questionId) {
        setJustSaved({
          result: attempt.result,
          belCount: attempt.belCount,
          tuntunCount: attempt.tuntunCount
        });
        savedTimeoutRef.current = setTimeout(() => {
          activeQuestionIdRef.current = null;
          setSelectedId(null);
          setSession(null);
          setJustSaved(null);
        }, 1200);
      }
    } catch (err) {
      if (activeQuestionIdRef.current === questionId) {
        setSessionError(
          err instanceof Error
            ? err.message
            : "Gagal menyimpan percobaan evaluasi."
        );
      }
    } finally {
      submitLockRef.current = false;
      if (activeQuestionIdRef.current === questionId) setSubmitPending(false);
    }
  }

  async function loadMoreBank() {
    if (!bank.nextCursor || loadingMoreBank) return;
    setListError(null);
    setLoadingMoreBank(true);
    try {
      const page = await apiFetch<BankPage>(
        `/api/evaluation/bank?cursor=${encodeURIComponent(bank.nextCursor)}&limit=20`,
        undefined,
        { method: "GET" }
      );
      setBank((current) => ({
        items: [
          ...current.items,
          ...page.items.filter(
            (item) =>
              !current.items.some(
                (existing) => existing.questionId === item.questionId
              )
          )
        ],
        nextCursor: page.nextCursor,
        totalCount: page.totalCount
      }));
    } catch (err) {
      setListError(
        err instanceof Error ? err.message : "Gagal memuat bank soal."
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
        `/api/evaluation/history?cursor=${encodeURIComponent(history.nextCursor)}&limit=20`,
        undefined,
        { method: "GET" }
      );
      setHistory((current) => ({
        items: [...current.items, ...page.items],
        nextCursor: page.nextCursor
      }));
    } catch (err) {
      setListError(
        err instanceof Error ? err.message : "Gagal memuat riwayat."
      );
    } finally {
      setLoadingMoreHistory(false);
    }
  }

  const revealButtonLabel = revealPending
    ? "Membuka..."
    : session && session.revealedAyahCount === 0
      ? "Lihat Ayat Pertama"
      : "Lihat Ayat Berikutnya";

  return (
    <div className="grid gap-4 pb-20">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Latihan Evaluasi</h1>
          <p className="mt-1 text-[var(--muted)]">
            Latih ulang soal yang belum lancar, tanpa mengganggu siklus 604
            halaman.
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={selectRandomQuestion}
          disabled={randomPending || sessionLoading || bank.totalCount === 0}
        >
          <Shuffle aria-hidden className="h-4 w-4" />
          {randomPending ? "Mengacak..." : "Acak soal"}
        </Button>
      </div>

      <Card>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5 lg:divide-x lg:divide-[var(--border)]">
          <Metric
            icon={ListChecks}
            label="Soal evaluasi saat ini"
            value={bank.totalCount}
          />
          <Metric
            icon={History}
            label="Total percobaan"
            value={summary.totalAttempts}
            className="lg:pl-4"
          />
          <Metric
            icon={AlarmClock}
            label="Total bel"
            value={summary.totalBelCount}
            className="lg:pl-4"
          />
          <Metric
            icon={Repeat}
            label="Total tuntun"
            value={summary.totalTuntunCount}
            className="lg:pl-4"
          />
          <Metric
            icon={CheckCircle2}
            label="Lancar"
            value={summary.resultCounts.CORRECT}
            className="lg:pl-4"
          />
        </div>
      </Card>

      {listError ? (
        <Card role="alert" className="text-sm text-[var(--danger)]">
          {listError}
        </Card>
      ) : null}

      <Card>
        <h2 className="font-semibold">Bank Evaluasi</h2>
        {bank.totalCount === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted)]">
            Belum ada soal yang perlu dilatih ulang. Soal akan muncul di sini
            setelah dinilai &quot;Belum Lancar&quot; pada latihan utama.
          </p>
        ) : bank.items.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted)]">
            Masih ada {bank.totalCount} soal evaluasi. Tekan &quot;Acak
            soal&quot; atau muat halaman berikutnya untuk melanjutkan.
          </p>
        ) : (
          <div className="mt-3 grid gap-2">
            {bank.items.map((item) => (
              <button
                key={item.questionId}
                type="button"
                onClick={() => {
                  if (!sessionLoading) selectQuestion(item);
                }}
                aria-disabled={sessionLoading || undefined}
                aria-label={`Latih soal belum lancar: ${item.fragmentText}`}
                className={`rounded-md border p-3 text-left text-sm transition ${sessionLoading ? "pointer-events-none opacity-70" : ""} ${item.questionId === selectedId ? "border-[var(--primary)] bg-emerald-50" : "border-[var(--border)] bg-white hover:bg-slate-50"}`}
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                    Belum Lancar
                  </span>
                  {item.lastAttemptAt ? (
                    <span className="text-[10px] text-[var(--muted)]">
                      Dicoba{" "}
                      {new Date(item.lastAttemptAt).toLocaleDateString("id-ID")}
                    </span>
                  ) : null}
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
        )}
        {bank.totalCount > 0 && bank.nextCursor ? (
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

      {selectedId && (sessionLoading || session) ? (
        <div
          ref={randomQuestionFocusRef}
          tabIndex={-1}
          aria-labelledby="evaluation-question-heading"
          className="scroll-mt-20 outline-none"
        >
          <Card className="grid gap-4 border-l-4 border-l-[var(--primary)] tasmiq-panel-enter">
            <div>
              <h2 id="evaluation-question-heading" className="font-semibold">
                Latihan ingatan
              </h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Ingat ayat berikut dari hafalan, buka satu per satu untuk
                memeriksa, lalu catat hasilnya.
              </p>
            </div>
            {sessionError ? (
              <p role="alert" className="text-sm text-[var(--danger)]">
                {sessionError}
              </p>
            ) : null}
            {sessionLoading || !session ? (
              <p className="text-sm text-[var(--muted)]">Memuat sesi...</p>
            ) : justSaved ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                Tersimpan: {resultLabel(justSaved.result)} (bel{" "}
                {justSaved.belCount}, tuntun {justSaved.tuntunCount})
              </div>
            ) : (
              <>
                <p
                  className="quran-text rounded-md bg-[#fbfaf4] p-4 text-right text-3xl"
                  translate="no"
                  lang="ar"
                  dir="rtl"
                >
                  {session.fragmentText}
                  <span aria-hidden className="text-[var(--accent)]">
                    {" "}
                    ...
                  </span>
                </p>
                {session.verses.length > 0 || revealPending ? (
                  <div className="grid max-h-[28rem] gap-3 overflow-y-auto rounded-md border border-[var(--border)] tasmiq-panel-enter">
                    <p className="sticky top-0 z-10 border-b border-[var(--border)] bg-[#fbfaf4] px-4 py-2 text-sm text-[var(--muted)]">
                      Ayat {session.revealedAyahCount}/{session.totalAyahCount}{" "}
                      terbuka
                      {session.isComplete ? " - halaman ini selesai" : ""}
                    </p>
                    <div className="grid gap-3 p-4 pt-0">
                      {session.verses.map((verse) => (
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
                      {revealPending ? <RevealSkeletonRow /> : null}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-[var(--muted)]">
                    Ayat {session.revealedAyahCount}/{session.totalAyahCount}{" "}
                    terbuka
                  </p>
                )}
                {!session.isComplete ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button
                      onClick={revealNext}
                      disabled={revealPending || revealAllPending}
                    >
                      <Eye aria-hidden className="h-4 w-4" />{" "}
                      {revealButtonLabel}
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
                      onAssess={submitAttempt}
                      pending={submitPending}
                    />
                  </div>
                )}
              </>
            )}
          </Card>
        </div>
      ) : null}

      <Card>
        <div className="flex items-center gap-2">
          <History aria-hidden className="h-5 w-5 text-[var(--primary)]" />
          <h2 className="font-semibold">Riwayat Evaluasi</h2>
        </div>
        {history.items.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted)]">
            Belum ada percobaan evaluasi.
          </p>
        ) : (
          <div className="mt-3 grid gap-2">
            {history.items.map((attempt) => (
              <div
                key={attempt.id}
                className="rounded-md bg-slate-50 p-3 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {resultLabel(attempt.result)}
                  </span>
                  <span className="text-xs text-[var(--muted)]">
                    {new Date(attempt.createdAt).toLocaleString("id-ID")}
                  </span>
                </div>
                <p
                  className="quran-text mt-1 text-right text-base"
                  translate="no"
                  lang="ar"
                  dir="rtl"
                >
                  {attempt.fragmentText}
                </p>
                {attempt.result !== "CORRECT" ? (
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {formatAssessmentPerformance(
                      attempt.belCount,
                      attempt.tuntunCount
                    )}
                  </p>
                ) : null}
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

function resultLabel(result: Assessment) {
  return assessmentClassificationLabel(result);
}
