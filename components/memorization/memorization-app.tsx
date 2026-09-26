"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookMarked,
  Check,
  CheckCircle2,
  Eye,
  FastForward,
  FileText,
  Headphones,
  Lightbulb,
  Layers3,
  MapPinned,
  Play,
  Volume2,
  VolumeX
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { productConfig } from "@/lib/config";
import { apiFetch } from "@/lib/client/api";
import {
  assessmentClassificationLabel,
  deriveAssessment
} from "@/lib/memorization/assessment";
import { AssessmentForm, RevealSkeletonRow } from "./assessment-form";

type Assessment = "CORRECT" | "PARTIAL" | "MISSED";
type MemorizationScope = "THIRTY_JUZ" | "TWENTY_JUZ" | "TEN_JUZ";

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

type HintLine = { type: string; text: string };

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
  hints: HintLine[];
  reveal: RevealProgress;
  assessment: Assessment | null;
};

type PackageDto = {
  id: string;
  packageNumber: number;
  state: string;
  cycle: {
    cycleNumber: number;
    scope: MemorizationScope;
    state: string;
    pagesTested: number;
    targetPages: number;
  };
  questions: Question[];
  activeQuestionId: string | null;
};

type PendingAction =
  "package" | "reveal" | "reveal-all" | `hint:${string}` | null;

type HintMutation = {
  questionId: string;
  hint: { type: string; text: string };
  availableHints: Question["availableHints"];
  fragmentText?: string;
};

type RevealMutation = RevealProgress & { questionId: string };

type AssessmentMutation = {
  questionId: string;
  assessment: Assessment;
  belCount: number;
  tuntunCount: number;
  packageCompleted: boolean;
};

type PendingAssessment = {
  assessment: Assessment;
  belCount: number;
  tuntunCount: number;
};

const scopeOptions = [
  {
    value: "THIRTY_JUZ",
    label: "30 Juz",
    description: "Juz 1-30",
    distribution: "3 wilayah wajib + 1 acak"
  },
  {
    value: "TWENTY_JUZ",
    label: "20 Juz",
    description: "Juz 1-20",
    distribution: "2 soal Juz 1-10 + 2 soal Juz 11-20"
  },
  {
    value: "TEN_JUZ",
    label: "10 Juz",
    description: "Juz 1-10",
    distribution: "1 soal dari tiap seperempat bagian"
  }
] as const satisfies readonly {
  value: MemorizationScope;
  label: string;
  description: string;
  distribution: string;
}[];

function scopeLabel(scope: MemorizationScope) {
  return (
    scopeOptions.find((option) => option.value === scope)?.label ?? "30 Juz"
  );
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

export function MemorizationApp({
  initialPackage = null
}: {
  initialPackage?: PackageDto | null;
}) {
  const [pkg, setPkg] = useState<PackageDto | null>(initialPackage);
  const [selectedScope, setSelectedScope] = useState<MemorizationScope>(
    initialPackage?.cycle.scope ?? "THIRTY_JUZ"
  );
  const [activeIndex, setActiveIndex] = useState(() =>
    initialPackage ? firstActiveIndex(initialPackage) : 0
  );
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [pendingAssessments, setPendingAssessments] = useState<
    Record<string, PendingAssessment>
  >({});
  const [error, setError] = useState<string | null>(null);
  const actionLockRef = useRef(false);
  const inFlightAssessmentsRef = useRef(new Set<string>());
  const revealAnnounceRef = useRef<HTMLDivElement>(null);

  const question = pkg?.questions[activeIndex] ?? null;
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
  // The active question must be fully revealed (or already assessed)
  // before the user can navigate away to a different question in the
  // package - grading, switching questions, and advancing are all gated
  // on reveal completeness, enforced here and again server-side in
  // submitAssessment.
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
    await loadPackageForScope(selectedScope);
  }

  async function loadPackageForScope(
    scope: MemorizationScope,
    resetScopeOnError?: MemorizationScope
  ) {
    if (pendingAssessmentCount > 0 || !beginAction("package")) return;
    try {
      const data = await apiFetch<PackageDto>(
        "/api/memorization/next-package",
        {
          scope
        }
      );
      setPkg(data);
      setSelectedScope(data.cycle.scope);
      setActiveIndex(firstActiveIndex(data));
    } catch (err) {
      if (resetScopeOnError) setSelectedScope(resetScopeOnError);
      setError(err instanceof Error ? err.message : "Gagal memuat paket.");
    } finally {
      endAction();
    }
  }

  async function switchScope(scope: MemorizationScope) {
    if (scope === pkg?.cycle.scope) {
      setSelectedScope(scope);
      return;
    }
    const previousScope = pkg?.cycle.scope;
    setSelectedScope(scope);
    await loadPackageForScope(scope, previousScope);
  }

  async function requestHint(type: string) {
    if (!question || !beginAction(`hint:${type}`)) return;
    try {
      const data = await apiFetch<HintMutation>("/api/memorization/hint", {
        questionId: question.id,
        type
      });
      setPkg((current) =>
        current
          ? {
              ...current,
              questions: current.questions.map((item) =>
                item.id === data.questionId
                  ? {
                      ...item,
                      availableHints: data.availableHints,
                      fragmentText: data.fragmentText ?? item.fragmentText,
                      hints: [
                        ...item.hints.filter(
                          (hint) =>
                            !(
                              hint.type === data.hint.type &&
                              data.hint.type !== "EXTEND_FRAGMENT" &&
                              data.hint.type !== "NEXT_VERSE"
                            )
                        ),
                        { type: data.hint.type, text: data.hint.text }
                      ]
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
    const expectedRevealedCount = question.reveal.revealedAyahCount;
    try {
      const data = await apiFetch<RevealMutation>("/api/memorization/reveal", {
        questionId: question.id,
        expectedRevealedCount
      });
      applyRevealMutation(data);
      if (revealAnnounceRef.current) {
        const last = data.verses[data.verses.length - 1];
        revealAnnounceRef.current.textContent = last
          ? `Ayat ${data.revealedAyahCount} dari ${data.totalAyahCount} terbuka: ${last.verseKey}`
          : "";
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Gagal membuka ayat berikutnya."
      );
    } finally {
      endAction();
    }
  }

  /**
   * "Soal selesai dijawab" - lets a user who already answered from memory
   * (on paper, out loud, in their head) skip clicking through one ayah at
   * a time. This does NOT bypass the reveal-completion gate on grading -
   * it calls /api/memorization/reveal-all, which reveals every remaining
   * ayah in one server round trip instead of looping the single-ayah
   * reveal endpoint N times (previously the real source of the long wait
   * on questions spanning many ayat - N sequential network round trips,
   * not server-side slowness). The answer still only ever arrives after
   * this explicit request, exactly as a single reveal click only sends
   * the next ayah after being clicked; only how many ayat one authorized
   * request returns changed, not any access without a request. The
   * server-side requirement that grading only follows a fully-revealed
   * question (submitAssessment's revealIncompleteError) is untouched.
   */
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
      if (revealAnnounceRef.current) {
        revealAnnounceRef.current.textContent = `Seluruh ${data.totalAyahCount} ayat telah terbuka.`;
      }
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
    const assessment = deriveAssessment(belCount, tuntunCount);
    const previousPackage = pkg;
    const previousIndex = activeIndex;
    const nextQuestions = pkg.questions.map((item) =>
      item.id === assessedQuestion.id ? { ...item, assessment } : item
    );
    const nextPackageCompleted = nextQuestions.every((item) => item.assessment);
    const nextActiveId =
      nextQuestions.find((item) => !item.assessment)?.id ?? assessedQuestion.id;

    inFlightAssessmentsRef.current.add(assessedQuestion.id);
    setPendingAssessments((current) => ({
      ...current,
      [assessedQuestion.id]: { assessment, belCount, tuntunCount }
    }));
    setError(null);
    setPkg({
      ...pkg,
      state: nextPackageCompleted ? "COMPLETED" : pkg.state,
      questions: nextQuestions,
      activeQuestionId: nextActiveId
    });
    if (!nextPackageCompleted) {
      const nextIndex = nextQuestions.findIndex(
        (item) => item.id === nextActiveId
      );
      if (nextIndex >= 0) setActiveIndex(nextIndex);
    }

    try {
      const data = await apiFetch<AssessmentMutation>(
        "/api/memorization/assessment",
        {
          questionId: assessedQuestion.id,
          belCount,
          tuntunCount
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

  if (!pkg || !question) {
    return (
      <div className="mx-auto grid max-w-4xl gap-6 pb-24">
        <div className="flex items-start gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-md bg-[var(--primary)] text-white shadow-sm">
            <Headphones aria-hidden className="size-6" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[var(--primary)]">
              Latihan utama
            </p>
            <h1 className="mt-1 text-3xl font-semibold">Tes hafalan</h1>
            <p className="mt-2 max-w-2xl text-[var(--muted)]">
              {productConfig.tagline}
            </p>
          </div>
        </div>
        <Card className="grid gap-6 p-5 md:p-6">
          <ScopeSelector
            value={selectedScope}
            disabled={pendingAction !== null}
            onChange={setSelectedScope}
          />
          {error ? (
            <p
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-[var(--danger)]"
            >
              {error}
            </p>
          ) : null}
          <div className="flex flex-col gap-3 border-t border-[var(--border)] pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-[var(--muted)]">
              Setiap halaman muncul satu kali sebelum siklus berulang.
            </p>
            <Button
              className="w-full sm:w-auto"
              onClick={loadPackage}
              disabled={pendingAction === "package"}
            >
              <Play aria-hidden className="size-4 fill-current" />
              {pendingAction === "package" ? "Menyiapkan..." : "Mulai latihan"}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const assessedCount = pkg.questions.filter((item) => item.assessment).length;
  const scopeSwitchDisabled =
    pendingAction !== null || pendingAssessmentCount > 0;

  if (packageComplete) {
    return (
      <div className="grid gap-4 pb-24">
        <ScopeSwitcher
          value={pkg.cycle.scope}
          loadingValue={pendingAction === "package" ? selectedScope : null}
          disabled={scopeSwitchDisabled}
          onChange={switchScope}
        />
        <MemorizationHeader
          pkg={pkg}
          pendingAssessmentCount={pendingAssessmentCount}
          switchingScope={pendingAction === "package"}
        />
        {error ? (
          <Card role="alert" className="text-sm text-[var(--danger)]">
            {error}
          </Card>
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
      <ScopeSwitcher
        value={pkg.cycle.scope}
        loadingValue={pendingAction === "package" ? selectedScope : null}
        disabled={scopeSwitchDisabled}
        onChange={switchScope}
      />
      <MemorizationHeader
        pkg={pkg}
        pendingAssessmentCount={pendingAssessmentCount}
        switchingScope={pendingAction === "package"}
      />
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${pkg.questions.length}, 1fr)` }}
        aria-label="Pertanyaan"
      >
        {pkg.questions.map((item, index) => (
          <button
            key={item.id}
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
              setActiveIndex(index);
            }}
            className={`flex min-h-11 items-center justify-center gap-2 rounded-md border px-2 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-55 ${
              index === activeIndex
                ? "border-[var(--primary)] bg-[var(--primary)] text-white shadow-sm"
                : item.assessment
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                  : "border-[var(--border)] bg-white hover:border-slate-300 hover:bg-slate-50"
            }`}
          >
            {item.assessment ? <Check aria-hidden className="size-4" /> : null}
            <span>Soal {item.order}</span>
          </button>
        ))}
      </div>
      {error ? (
        <Card className="text-sm text-[var(--danger)]">{error}</Card>
      ) : null}
      <div aria-live="polite" className="sr-only" ref={revealAnnounceRef} />
      <Card className="grid gap-5">
        <QuestionPanel
          key={question.id}
          question={question}
          pendingAction={pendingAction}
          canUseQuestionActions={canUseQuestionActions}
          pendingAssessment={pendingAssessments[question.id] ?? null}
          onHint={requestHint}
          onRevealNext={revealNext}
          onRevealAll={revealAll}
          onAssess={assess}
        />
      </Card>
    </div>
  );
}

function ScopeSelector({
  value,
  disabled,
  onChange
}: {
  value: MemorizationScope;
  disabled: boolean;
  onChange: (scope: MemorizationScope) => void;
}) {
  return (
    <fieldset className="grid gap-3" disabled={disabled}>
      <legend className="text-lg font-semibold">Pilih cakupan hafalan</legend>
      <div className="grid gap-3 md:grid-cols-3">
        {scopeOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={`relative min-h-32 rounded-md border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-55 ${
              value === option.value
                ? "border-[var(--primary)] bg-emerald-50 shadow-sm"
                : "border-[var(--border)] bg-white hover:border-slate-300 hover:bg-slate-50"
            }`}
          >
            <span className="flex items-start justify-between gap-3">
              <span>
                <span className="block text-lg font-semibold">
                  {option.label}
                </span>
                <span className="mt-0.5 block text-xs font-medium uppercase text-[var(--muted)]">
                  {option.description}
                </span>
              </span>
              <span
                className={`flex size-6 shrink-0 items-center justify-center rounded-full border ${
                  value === option.value
                    ? "border-[var(--primary)] bg-[var(--primary)] text-white"
                    : "border-[var(--border)] bg-white text-transparent"
                }`}
              >
                <Check aria-hidden className="size-3.5" />
              </span>
            </span>
            <span className="mt-4 block text-sm leading-5 text-[var(--muted)]">
              {option.distribution}
            </span>
            <span className="mt-2 block text-xs font-medium text-[var(--primary)]">
              Paket penuh: 4 soal
            </span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function ScopeSwitcher({
  value,
  loadingValue,
  disabled,
  onChange
}: {
  value: MemorizationScope;
  loadingValue: MemorizationScope | null;
  disabled: boolean;
  onChange: (scope: MemorizationScope) => void;
}) {
  return (
    <section className="grid gap-3 rounded-md border border-[var(--border)] bg-white p-3 shadow-sm sm:grid-cols-[auto_1fr] sm:items-center">
      <div className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
        <Layers3 aria-hidden className="size-4 text-[var(--primary)]" />
        Kategori
      </div>
      <div className="grid gap-2 sm:grid-cols-3" aria-label="Kategori hafalan">
        {scopeOptions.map((option) => {
          const active = value === option.value;
          const loading =
            loadingValue === option.value && loadingValue !== value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              disabled={disabled || active}
              onClick={() => onChange(option.value)}
              className={`min-h-12 rounded-md border px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-70 ${
                active
                  ? "border-[var(--primary)] bg-emerald-50 text-[var(--primary)]"
                  : "border-[var(--border)] bg-white hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-semibold">{option.label}</span>
                {active ? <Check aria-hidden className="size-4" /> : null}
              </span>
              <span className="mt-0.5 block text-xs text-[var(--muted)]">
                {loading ? "Memuat kategori..." : option.description}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function MemorizationHeader({
  pkg,
  pendingAssessmentCount,
  switchingScope
}: {
  pkg: PackageDto;
  pendingAssessmentCount: number;
  switchingScope: boolean;
}) {
  const pagesTested = finiteNonNegative(pkg.cycle.pagesTested);
  const targetPages = finiteNonNegative(pkg.cycle.targetPages);
  const progress =
    targetPages > 0
      ? Math.min(100, Math.round((pagesTested / targetPages) * 100))
      : 0;

  return (
    <div className="grid gap-3 rounded-md border border-[var(--border)] bg-white p-4 shadow-sm md:grid-cols-[1fr_auto] md:items-center">
      <div className="min-w-0">
        <p className="text-sm font-medium text-[var(--muted)]">
          {scopeLabel(pkg.cycle.scope)} - Siklus {pkg.cycle.cycleNumber} - Paket{" "}
          {pkg.packageNumber}
        </p>
        <h1 className="text-2xl font-semibold">Latihan hafalan</h1>
        {pendingAssessmentCount > 0 ? (
          <p className="mt-1 text-sm text-[var(--muted)]">
            Menyimpan evaluasi...
          </p>
        ) : null}
        {switchingScope ? (
          <p className="mt-1 text-sm text-[var(--muted)]">
            Memuat kategori hafalan...
          </p>
        ) : null}
      </div>
      <div className="grid min-w-44 gap-2">
        <div className="flex items-center justify-between gap-3 text-xs font-medium text-[var(--muted)]">
          <span>Progres siklus</span>
          <span>{targetPages > 0 ? `${pagesTested}/${targetPages}` : "-"}</span>
        </div>
        <div
          className="h-2 overflow-hidden rounded-full bg-slate-100"
          role="progressbar"
          aria-label="Progres halaman dalam siklus"
          aria-valuemin={0}
          aria-valuemax={targetPages > 0 ? targetPages : 1}
          aria-valuenow={Math.min(pagesTested, targetPages || 1)}
        >
          <div
            className="h-full rounded-full bg-[var(--accent)] transition-[width]"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-right text-xs text-[var(--muted)]">
          {targetPages > 0
            ? `${progress}% halaman teruji`
            : "Progres disiapkan"}
        </p>
      </div>
    </div>
  );
}

function finiteNonNegative(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function QuestionPanel({
  question,
  pendingAction,
  canUseQuestionActions,
  pendingAssessment,
  onHint,
  onRevealNext,
  onRevealAll,
  onAssess
}: {
  question: Question;
  pendingAction: PendingAction;
  canUseQuestionActions: boolean;
  pendingAssessment: PendingAssessment | null;
  onHint: (type: string) => void;
  onRevealNext: () => void;
  onRevealAll: () => void;
  onAssess: (belCount: number, tuntunCount: number) => void;
}) {
  const questionComplete = question.assessment !== null;
  const reveal = question.reveal;
  const [showVisualPrompt, setShowVisualPrompt] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  // Grading is only allowed once the entire boundary has been revealed -
  // enforced again server-side in submitAssessment - so there is no
  // separate "grade early" affordance; this panel simply appears once
  // reveal.isComplete, derived directly during render.
  const assessmentOpen = reveal.isComplete;
  const revealButtonLabel = useMemo(() => {
    if (pendingAction === "reveal") return "Membuka...";
    return reveal.revealedAyahCount === 0
      ? "Lihat Ayat Pertama"
      : "Lihat Ayat Berikutnya";
  }, [pendingAction, reveal.revealedAyahCount]);

  useEffect(() => {
    return () => {
      window.speechSynthesis?.cancel();
    };
  }, [question.id]);

  function speakPrompt() {
    if (!("speechSynthesis" in window)) {
      setSpeechError("Audio tidak tersedia di browser ini.");
      setShowVisualPrompt(true);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(question.fragmentText);
    utterance.lang = "ar-SA";
    utterance.rate = 0.82;
    const arabicVoice = window.speechSynthesis
      .getVoices()
      .find((voice) => voice.lang.toLowerCase().startsWith("ar"));
    if (arabicVoice) utterance.voice = arabicVoice;
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => {
      setIsSpeaking(false);
      setSpeechError("Audio gagal diputar. Gunakan teks soal.");
      setShowVisualPrompt(true);
    };
    setSpeechError(null);
    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }

  function stopPrompt() {
    window.speechSynthesis?.cancel();
    setIsSpeaking(false);
  }

  return (
    <div className="grid gap-5 tasmiq-panel-enter">
      <section className="overflow-hidden rounded-md border border-[#27584b] bg-[#173b32] text-white shadow-sm">
        <div className="grid gap-5 p-5 sm:grid-cols-[auto_1fr] sm:items-center md:p-6">
          <div
            className={`flex size-16 items-center justify-center rounded-full bg-white/10 text-[#f2bd62] ${isSpeaking ? "tasmiq-audio-active" : ""}`}
          >
            <Headphones aria-hidden className="size-8" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase text-emerald-100">
              Soal {question.order} dari {question.totalQuestions}
            </p>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-xl font-semibold">Audio soal</h2>
              <span className="text-sm text-emerald-100" aria-live="polite">
                {isSpeaking ? "Sedang diputar" : "Siap diputar"}
              </span>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                onClick={speakPrompt}
                className="bg-white text-[#173b32] hover:bg-emerald-50"
              >
                <Volume2 aria-hidden className="size-4" />
                {isSpeaking ? "Putar ulang" : "Putar soal"}
              </Button>
              {isSpeaking ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={stopPrompt}
                  className="text-white hover:bg-white/10"
                >
                  <VolumeX aria-hidden className="size-4" />
                  Hentikan
                </Button>
              ) : null}
            </div>
          </div>
        </div>
        <div className="border-t border-white/10 bg-black/10 px-5 py-3 md:px-6">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setShowVisualPrompt((current) => !current)}
            aria-expanded={showVisualPrompt}
            className="min-h-9 px-2 text-emerald-50 hover:bg-white/10"
          >
            <FileText aria-hidden className="size-4" />
            {showVisualPrompt ? "Sembunyikan teks" : "Lihat teks soal"}
          </Button>
        </div>
        {speechError ? (
          <p
            role="alert"
            className="border-t border-red-300/20 bg-red-950/30 px-5 py-3 text-sm text-red-100 md:px-6"
          >
            {speechError}
          </p>
        ) : null}
        {showVisualPrompt ? (
          <div
            className="quran-text min-h-44 border-t border-white/10 bg-[#fbfaf4] p-5 text-right text-4xl text-[var(--foreground)] md:p-6 md:text-5xl"
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
      </section>
      {questionComplete ? (
        <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <CheckCircle2 aria-hidden className="size-4 shrink-0" />
          <span>
            Soal ini sudah dievaluasi: {assessmentLabel(question.assessment)}
          </span>
        </div>
      ) : null}
      {pendingAssessment ? (
        <div className="rounded-md bg-slate-50 p-3 text-sm text-[var(--muted)]">
          Menyimpan: {assessmentLabel(pendingAssessment.assessment)} (bel{" "}
          {pendingAssessment.belCount}, tuntun {pendingAssessment.tuntunCount})
        </div>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-3">
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
      </div>
      {question.hints.length ? (
        <div className="grid gap-2 tasmiq-panel-enter">
          {question.hints.map((hint, index) => (
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
          {pendingAction === "reveal" ? <RevealSkeletonRow /> : null}
        </div>
      ) : pendingAction === "reveal" ? (
        <div className="grid gap-3 rounded-md border border-[var(--border)] p-4 tasmiq-panel-enter">
          <RevealSkeletonRow />
        </div>
      ) : null}
      {/* Below the revealed-ayat list, not above it, so the button stays
          anchored right after the last-opened ayah as the list grows -
          requested explicitly so the reveal action always sits next to
          what it just added, not scrolled away above a growing list. */}
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
          <AssessmentForm onAssess={onAssess} />
        </div>
      ) : null}
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
  return assessment
    ? assessmentClassificationLabel(assessment)
    : "Belum dinilai";
}
