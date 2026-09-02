"use client";

import { useRef, useState } from "react";
import {
  CheckCircle2,
  Eye,
  FastForward,
  History,
  ListChecks,
  Trophy,
  Video,
  RotateCcw,
  FileText
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { apiFetch } from "@/lib/client/api";
import { AssessmentForm } from "@/components/memorization/assessment-form";

type Assessment = "CORRECT" | "PARTIAL" | "MISSED";
type CompetitionBranch = "HIFZH_30_JUZ_INDEPENDENT" | "TAFSIR_ARABIC";

type RevealedAyah = {
  verseKey: string;
  text: string;
  surah: string;
  juz: number;
  page: number;
};

type RevealProgress = {
  revealedAyahCount: number;
  totalAyahCount: number;
  isComplete: boolean;
  verses: RevealedAyah[];
};

type PackageQuestion = {
  id: string;
  order: number;
  fragmentText: string;
  audio: {
    videoId: string;
    startSeconds: number;
    endSeconds: number;
  };
  reveal: RevealProgress;
  assessment: Assessment | null;
};

type PackageDto = {
  id: string;
  competitionDay: number;
  competitionBranch: CompetitionBranch;
  participantDisplayNo: number;
  state: "IN_PROGRESS" | "COMPLETED";
  questions: PackageQuestion[];
  activeQuestionId: string | null;
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

type PendingAction = "package" | "reveal" | "reveal-all" | null;

type RevealMutation = RevealProgress & { questionId: string };

type AssessmentMutation = {
  questionId: string;
  assessment: Assessment;
  belCount: number;
  tuntunCount: number;
};

function branchLabel(branch: CompetitionBranch) {
  return branch === "HIFZH_30_JUZ_INDEPENDENT" ? "30 Juz" : "Tafsir";
}

function assessmentLabel(assessment: Assessment | null) {
  if (assessment === "CORRECT") return "Benar";
  if (assessment === "PARTIAL") return "Sebagian benar";
  return "Belum ingat";
}

function firstActiveIndex(pkg: PackageDto) {
  if (pkg.activeQuestionId) {
    const index = pkg.questions.findIndex(
      (item) => item.id === pkg.activeQuestionId
    );
    if (index >= 0) return index;
  }
  return 0;
}

export function StqhnApp({
  initialPackage,
  initialHistory,
  initialSummary
}: {
  initialPackage: PackageDto | null;
  initialHistory: HistoryPage;
  initialSummary: Summary;
}) {
  const [pkg, setPkg] = useState<PackageDto | null>(initialPackage);
  const [activeIndex, setActiveIndex] = useState(() =>
    initialPackage ? firstActiveIndex(initialPackage) : 0
  );
  const [history, setHistory] = useState(initialHistory);
  const [summary, setSummary] = useState(initialSummary);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [pendingAssessmentIds, setPendingAssessmentIds] = useState<Set<string>>(
    new Set()
  );
  const [loadingMoreHistory, setLoadingMoreHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const actionLockRef = useRef(false);
  const inFlightAssessmentsRef = useRef(new Set<string>());
  // Tracks which question the user is currently looking at, independent
  // of React re-renders, so a slow assessment response landing after the
  // user has already switched to a different question doesn't yank their
  // view back to "the next unassessed one" out from under them.
  const activeQuestionIdRef = useRef<string | null>(
    initialPackage
      ? (initialPackage.questions[firstActiveIndex(initialPackage)]?.id ?? null)
      : null
  );

  const question = pkg?.questions[activeIndex] ?? null;
  const pendingAssessmentCount = pendingAssessmentIds.size;
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
  const canSwitchQuestion = Boolean(
    question && (question.reveal.isComplete || questionComplete)
  );

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
      const data = await apiFetch<PackageDto>("/api/stqhn/package");
      const nextIndex = firstActiveIndex(data);
      setPkg(data);
      setActiveIndex(nextIndex);
      activeQuestionIdRef.current = data.questions[nextIndex]?.id ?? null;
      // loadPackage is only ever called with no active package (initial
      // "Mulai latihan") or after the current one just completed ("Paket
      // berikutnya") - getOrAllocateStqhnPackage never resumes in either
      // case, so this response is always a freshly allocated package,
      // and every one of its questions is newly "attempted" server-side.
      setSummary((current) => ({
        ...current,
        attemptedCount: current.attemptedCount + data.questions.length
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat paket.");
    } finally {
      endAction();
    }
  }

  function applyRevealMutation(data: RevealMutation) {
    setPkg((current) =>
      current
        ? {
            ...current,
            questions: current.questions.map((item) =>
              item.id === data.questionId
                ? {
                    ...item,
                    reveal: {
                      revealedAyahCount: data.revealedAyahCount,
                      totalAyahCount: data.totalAyahCount,
                      isComplete: data.isComplete,
                      verses: data.verses
                    }
                  }
                : item
            )
          }
        : current
    );
  }

  async function revealNext() {
    if (!question || !canUseQuestionActions) return;
    if (!beginAction("reveal")) return;
    try {
      const data = await apiFetch<RevealMutation>("/api/memorization/reveal", {
        questionId: question.id,
        expectedRevealedCount: question.reveal.revealedAyahCount
      });
      applyRevealMutation(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Gagal membuka ayat berikutnya."
      );
    } finally {
      endAction();
    }
  }

  async function revealAll() {
    if (!question || !canUseQuestionActions) return;
    if (!beginAction("reveal-all")) return;
    const questionId = question.id;
    try {
      const data = await apiFetch<RevealMutation>(
        "/api/memorization/reveal-all",
        { questionId }
      );
      applyRevealMutation(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Gagal membuka seluruh ayat."
      );
    } finally {
      endAction();
    }
  }

  async function assess(belCount: number, tuntunCount: number) {
    if (!pkg || !question || inFlightAssessmentsRef.current.has(question.id))
      return;

    const assessedQuestion = question;
    const previousPackage = pkg;
    const previousIndex = activeIndex;
    // Re-selecting an already-assessed question and resubmitting is a
    // valid, server-side idempotent replay (see submitAssessment in
    // lib/memorization/service.ts) - it must not double-count locally.
    const wasAlreadyAssessed = assessedQuestion.assessment !== null;

    inFlightAssessmentsRef.current.add(assessedQuestion.id);
    setPendingAssessmentIds((current) => {
      const next = new Set(current);
      next.add(assessedQuestion.id);
      return next;
    });
    setError(null);

    try {
      const data = await apiFetch<AssessmentMutation>(
        "/api/memorization/assessment",
        { questionId: assessedQuestion.id, belCount, tuntunCount },
        { keepalive: true }
      );
      setPkg((current) => {
        if (!current) return current;
        const nextQuestions = current.questions.map((item) =>
          item.id === data.questionId
            ? { ...item, assessment: data.assessment }
            : item
        );
        const nextComplete = nextQuestions.every((item) => item.assessment);
        const nextActiveId =
          nextQuestions.find((item) => !item.assessment)?.id ?? data.questionId;
        // Only auto-advance if the user is still looking at the question
        // they just graded - if they've since switched to another
        // question in the package while this request was in flight, jump
        // straight there instead of yanking them back to "the next
        // unassessed one" out from under a request they didn't make.
        if (!nextComplete && activeQuestionIdRef.current === data.questionId) {
          const nextIndex = nextQuestions.findIndex(
            (item) => item.id === nextActiveId
          );
          if (nextIndex >= 0) {
            activeQuestionIdRef.current = nextActiveId;
            setActiveIndex(nextIndex);
          }
        }
        return {
          ...current,
          state: nextComplete ? "COMPLETED" : current.state,
          questions: nextQuestions,
          activeQuestionId: nextActiveId
        };
      });
      if (!wasAlreadyAssessed) {
        setSummary((current) => ({
          ...current,
          correctCount:
            current.correctCount + (data.assessment === "CORRECT" ? 1 : 0),
          missedCount:
            current.missedCount + (data.assessment !== "CORRECT" ? 1 : 0)
        }));
      }
    } catch (err) {
      setPkg(previousPackage);
      setActiveIndex(previousIndex);
      setError(
        err instanceof Error
          ? `Evaluasi belum tersimpan: ${err.message}`
          : "Evaluasi belum tersimpan. Coba lagi."
      );
    } finally {
      inFlightAssessmentsRef.current.delete(assessedQuestion.id);
      setPendingAssessmentIds((current) => {
        const next = new Set(current);
        next.delete(assessedQuestion.id);
        return next;
      });
    }
  }

  async function loadMoreHistory() {
    if (!history.nextCursor || loadingMoreHistory) return;
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
      setError(
        err instanceof Error ? err.message : "Gagal memuat riwayat STQHN."
      );
    } finally {
      setLoadingMoreHistory(false);
    }
  }

  return (
    <div className="grid gap-4 pb-20">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Trophy aria-hidden className="h-6 w-6 text-[var(--primary)]" />
          STQHN 2025
        </h1>
        <p className="mt-1 text-[var(--muted)]">
          Bank soal hafalan asli dari Seleksi Tilawah Qur&apos;an dan Hafalan
          Nasional 2025 - diacak per paket peserta, tidak berulang sebelum semua
          paket dicoba.
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

      {error ? (
        <Card role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </Card>
      ) : null}

      {!pkg || !question ? (
        <Card className="grid gap-4">
          <div>
            <h2 className="text-xl font-semibold">Latihan Soal STQHN</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Setiap sesi berisi 1 paket (4 soal dari satu peserta), dipilih
              acak dan tidak akan berulang sampai semua paket pernah dicoba.
            </p>
          </div>
          <Button onClick={loadPackage} disabled={pendingAction === "package"}>
            {pendingAction === "package" ? "Memuat..." : "Mulai latihan"}
          </Button>
        </Card>
      ) : packageComplete ? (
        <Card className="grid gap-4 tasmiq-panel-enter">
          <div>
            <h2 className="text-xl font-semibold">Paket selesai</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Hari {pkg.competitionDay} - {branchLabel(pkg.competitionBranch)} -
              Peserta {pkg.participantDisplayNo}:{" "}
              {pkg.questions.filter((item) => item.assessment).length}/
              {pkg.questions.length} soal sudah dievaluasi.
            </p>
          </div>
          <Button
            onClick={loadPackage}
            disabled={pendingAction === "package" || pendingAssessmentCount > 0}
          >
            {pendingAction === "package" ? "Memuat..." : "Paket berikutnya"}
          </Button>
        </Card>
      ) : (
        <Card className="grid gap-5">
          <div>
            <p className="text-sm font-medium text-[var(--muted)]">
              Hari {pkg.competitionDay} - {branchLabel(pkg.competitionBranch)} -
              Peserta {pkg.participantDisplayNo}
            </p>
          </div>
          <div className="grid grid-cols-4 gap-2" aria-label="Pertanyaan">
            {pkg.questions.map((item, index) => (
              <button
                key={item.id}
                type="button"
                disabled={
                  questionActionsBusy ||
                  (index !== activeIndex && !canSwitchQuestion)
                }
                aria-label={
                  index !== activeIndex && !canSwitchQuestion
                    ? `Soal ${item.order} - buka seluruh ayat soal saat ini dahulu`
                    : `Soal ${item.order}`
                }
                onClick={() => {
                  activeQuestionIdRef.current = item.id;
                  setActiveIndex(index);
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
          <QuestionPanel
            key={question.id}
            question={question}
            pendingAction={pendingAction}
            canUseQuestionActions={canUseQuestionActions}
            pendingAssessment={pendingAssessmentIds.has(question.id)}
            onRevealNext={revealNext}
            onRevealAll={revealAll}
            onAssess={assess}
          />
        </Card>
      )}

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
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      item.assessment === "CORRECT"
                        ? "bg-emerald-100 text-emerald-900"
                        : "bg-amber-100 text-amber-900"
                    }`}
                  >
                    {assessmentLabel(item.assessment)}
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
  icon: typeof Trophy;
  label: string;
  value: number;
  className?: string;
}) {
  return (
    <div className={`grid gap-1 ${className}`}>
      <div className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
        <Icon aria-hidden className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className="text-xl font-semibold">{value}</p>
    </div>
  );
}

function QuestionPanel({
  question,
  pendingAction,
  canUseQuestionActions,
  pendingAssessment,
  onRevealNext,
  onRevealAll,
  onAssess
}: {
  question: PackageQuestion;
  pendingAction: PendingAction;
  canUseQuestionActions: boolean;
  pendingAssessment: boolean;
  onRevealNext: () => void;
  onRevealAll: () => void;
  onAssess: (belCount: number, tuntunCount: number) => void;
}) {
  const [audioReplayKey, setAudioReplayKey] = useState(0);
  const [showTextFallback, setShowTextFallback] = useState(false);
  const questionComplete = question.assessment !== null;
  const reveal = question.reveal;
  const assessmentOpen = reveal.isComplete;
  const revealButtonLabel =
    pendingAction === "reveal"
      ? "Membuka..."
      : reveal.revealedAyahCount === 0
        ? "Lihat Ayat Pertama"
        : "Lihat Ayat Berikutnya";

  return (
    <div className="grid gap-5 tasmiq-panel-enter">
      <div className="grid gap-3 rounded-md border border-[var(--border)] bg-slate-950 p-3 text-white">
        <div className="aspect-video min-h-[200px] w-full overflow-hidden rounded bg-black">
          <iframe
            key={`${question.id}-${audioReplayKey}`}
            className="h-full w-full"
            src={youtubeEmbedUrl(question.audio)}
            title={`Rekaman soal STQHN nomor ${question.order}`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-slate-200">
            Putar rekaman soal, lalu lanjutkan bacaannya dari hafalan.
          </p>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setAudioReplayKey((current) => current + 1)}
            disabled={questionComplete}
          >
            <RotateCcw aria-hidden className="h-4 w-4" /> Putar ulang
          </Button>
        </div>
      </div>
      <div className="grid gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() => setShowTextFallback((current) => !current)}
          aria-expanded={showTextFallback}
        >
          <FileText aria-hidden className="h-4 w-4" />
          {showTextFallback ? "Sembunyikan teks soal" : "Tampilkan teks soal"}
        </Button>
        {showTextFallback ? (
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
        ) : null}
      </div>
      {questionComplete ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          Soal ini sudah dievaluasi: {assessmentLabel(question.assessment)}
          {question.assessment !== "CORRECT"
            ? " - otomatis masuk ke Evaluasi Latihan untuk dicoba lagi."
            : ""}
        </div>
      ) : null}
      {pendingAssessment ? (
        <div className="rounded-md bg-slate-50 p-3 text-sm text-[var(--muted)]">
          Menyimpan evaluasi...
        </div>
      ) : null}
      {reveal.verses.length > 0 ? (
        <div className="grid gap-3 rounded-md border border-[var(--border)] p-4 tasmiq-panel-enter">
          <p className="text-sm text-[var(--muted)]">
            Ayat {reveal.revealedAyahCount}/{reveal.totalAyahCount} terbuka
            {reveal.isComplete ? " - halaman ini selesai" : ""}
          </p>
          {reveal.verses.map((verse) => (
            <div key={verse.verseKey} className="grid gap-1">
              <p className="text-xs text-[var(--muted)]">
                {verse.surah} - {verse.verseKey} - Juz {verse.juz} - Halaman{" "}
                {verse.page}
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
      ) : null}
      {!reveal.isComplete ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <Button
            onClick={onRevealNext}
            disabled={!canUseQuestionActions || reveal.isComplete}
          >
            <Eye aria-hidden className="h-4 w-4" /> {revealButtonLabel}
          </Button>
          <Button
            variant="secondary"
            onClick={onRevealAll}
            disabled={!canUseQuestionActions || reveal.isComplete}
          >
            <FastForward aria-hidden className="h-4 w-4" />{" "}
            {pendingAction === "reveal-all"
              ? "Membuka semua ayat..."
              : "Soal selesai dijawab"}
          </Button>
        </div>
      ) : null}
      {assessmentOpen ? (
        <div className="grid gap-3 rounded-md border border-[var(--border)] p-4 tasmiq-panel-enter">
          <p className="text-sm font-medium">Evaluasi jawaban</p>
          <p className="text-sm text-[var(--muted)]">
            Hanya 0 bel dan 0 tuntun yang dianggap mulus. Jika ada kesalahan
            atau tuntun, soal otomatis masuk ke Latihan Evaluasi.
          </p>
          <AssessmentForm onAssess={onAssess} pending={pendingAssessment} />
        </div>
      ) : null}
    </div>
  );
}

function youtubeEmbedUrl(audio: PackageQuestion["audio"]): string {
  const params = new URLSearchParams({
    start: String(Math.max(0, Math.floor(audio.startSeconds))),
    end: String(Math.max(1, Math.ceil(audio.endSeconds))),
    playsinline: "1",
    rel: "0"
  });
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(audio.videoId)}?${params.toString()}`;
}
