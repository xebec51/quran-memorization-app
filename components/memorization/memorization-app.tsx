"use client";

import { useCallback, useMemo, useState } from "react";
import { Eye, Lightbulb, MapPinned, BookMarked, StepForward, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { productConfig } from "@/lib/config";

type Question = {
  id: string;
  order: number;
  totalQuestions: number;
  fragmentText: string;
  availableHints: { juz: boolean; surah: boolean; extendFragment: boolean; nextVerse: boolean };
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

export function MemorizationApp() {
  const [pkg, setPkg] = useState<PackageDto | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [hints, setHints] = useState<HintLine[]>([]);
  const [answer, setAnswer] = useState<null | { surah: string; verseKey: string; juz: number; page: number; text: string; continuation: string[] }>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const question = pkg?.questions[activeIndex] ?? null;
  const questionHints = useMemo(() => hints.filter((hint) => hint.questionId === question?.id), [hints, question?.id]);

  async function api<T>(url: string, body?: unknown): Promise<T> {
    const response = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    const json = (await response.json()) as { data?: T; error?: { message: string } };
    if (!response.ok || !json.data) throw new Error(json.error?.message ?? "Permintaan gagal.");
    return json.data;
  }

  const loadPackage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<PackageDto>("/api/memorization/next-package", {});
      setPkg(data);
      setActiveIndex(0);
      setAnswer(null);
      setHints([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat paket.");
    } finally {
      setLoading(false);
    }
  }, []);

  async function requestHint(type: string) {
    if (!question) return;
    try {
      const data = await api<{ hint: { type: string; text: string }; question: Question }>("/api/memorization/hint", {
        questionId: question.id,
        type
      });
      setHints((current) => [...current.filter((hint) => !(hint.questionId === question.id && hint.type === data.hint.type && data.hint.type !== "EXTEND_FRAGMENT" && data.hint.type !== "NEXT_VERSE")), { questionId: question.id, type: data.hint.type, text: data.hint.text }]);
      setPkg((current) => current && { ...current, questions: current.questions.map((item) => (item.id === question.id ? data.question : item)) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal meminta petunjuk.");
    }
  }

  async function reveal() {
    if (!question) return;
    const data = await api<{ surah: string; verseKey: string; juz: number; page: number; text: string; continuation: string[] }>("/api/memorization/reveal", { questionId: question.id });
    setAnswer(data);
  }

  async function assess(assessment: "CORRECT" | "PARTIAL" | "MISSED") {
    if (!question) return;
    const data = await api<PackageDto>("/api/memorization/assessment", { questionId: question.id, assessment });
    setPkg(data);
    setAnswer(null);
    if (activeIndex < data.questions.length - 1) setActiveIndex(activeIndex + 1);
  }

  if (loading) return <Card>Memuat latihan...</Card>;
  if (error) {
    return (
      <Card>
        <p className="text-[var(--danger)]">{error}</p>
        <Button className="mt-4" onClick={loadPackage}>Coba lagi</Button>
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

  return (
    <div className="grid gap-4 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-[var(--muted)]">Siklus {pkg.cycle.cycleNumber} · Paket {pkg.packageNumber}</p>
          <h1 className="text-2xl font-semibold">Latihan Expert</h1>
        </div>
        <div className="rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm">{pkg.cycle.pagesTested}/604 halaman</div>
      </div>

      <div className="grid grid-cols-4 gap-2" aria-label="Pertanyaan">
        {pkg.questions.map((item, index) => (
          <button
            key={item.id}
            onClick={() => {
              setActiveIndex(index);
              setAnswer(null);
            }}
            className={`rounded-md border px-3 py-2 text-sm ${index === activeIndex ? "border-[var(--primary)] bg-emerald-50" : "border-[var(--border)] bg-white"}`}
          >
            {item.order}
          </button>
        ))}
      </div>

      <Card className="grid gap-5">
        <div className="quran-text min-h-44 rounded-md bg-[#fbfaf4] p-5 text-right text-4xl leading-loose md:text-5xl" translate="no" lang="ar" dir="rtl">
          {question.fragmentText}
          <span aria-hidden className="text-[var(--accent)]"> ...</span>
        </div>
        <div className="grid gap-2 sm:grid-cols-4">
          <Button variant="secondary" disabled={!question.availableHints.juz} onClick={() => requestHint("JUZ")}>
            <MapPinned aria-hidden className="h-4 w-4" /> Juz
          </Button>
          <Button variant="secondary" disabled={!question.availableHints.surah} onClick={() => requestHint("SURAH")}>
            <BookMarked aria-hidden className="h-4 w-4" /> Surah
          </Button>
          <Button variant="secondary" disabled={!question.availableHints.extendFragment} onClick={() => requestHint("EXTEND_FRAGMENT")}>
            <Lightbulb aria-hidden className="h-4 w-4" /> Tambah
          </Button>
          <Button variant="secondary" disabled={!question.availableHints.nextVerse} onClick={() => requestHint("NEXT_VERSE")}>
            <StepForward aria-hidden className="h-4 w-4" /> Ayat
          </Button>
        </div>
        {questionHints.length ? (
          <div className="grid gap-2">
            {questionHints.map((hint, index) => (
              <div key={`${hint.type}-${index}`} className="rounded-md bg-slate-50 p-3 text-sm">
                <span className="font-medium">{hintLabel(hint.type)}: </span>
                <span className={hint.type === "EXTEND_FRAGMENT" || hint.type === "NEXT_VERSE" ? "quran-text text-xl" : ""} translate={hint.type === "EXTEND_FRAGMENT" || hint.type === "NEXT_VERSE" ? "no" : undefined} dir={hint.type === "EXTEND_FRAGMENT" || hint.type === "NEXT_VERSE" ? "rtl" : undefined}>
                  {hint.text}
                </span>
              </div>
            ))}
          </div>
        ) : null}
        <Button onClick={reveal}>
          <Eye aria-hidden className="h-4 w-4" /> Lihat Jawaban
        </Button>
        {answer ? (
          <div className="grid gap-3 rounded-md border border-[var(--border)] p-4">
            <p className="text-sm text-[var(--muted)]">{answer.surah} · {answer.verseKey} · Juz {answer.juz} · Halaman {answer.page}</p>
            <p className="quran-text text-right text-3xl" translate="no" lang="ar" dir="rtl">{answer.text}</p>
            {answer.continuation.map((line, index) => (
              <p key={index} className="quran-text text-right text-2xl text-[var(--muted)]" translate="no" lang="ar" dir="rtl">{line}</p>
            ))}
            <div className="grid gap-2 sm:grid-cols-3">
              <Button onClick={() => assess("CORRECT")}><CheckCircle2 aria-hidden className="h-4 w-4" /> Benar</Button>
              <Button variant="secondary" onClick={() => assess("PARTIAL")}>Sebagian benar</Button>
              <Button variant="danger" onClick={() => assess("MISSED")}>Belum ingat</Button>
            </div>
          </div>
        ) : null}
      </Card>

      {pkg.state === "COMPLETED" ? (
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-medium">Paket selesai.</p>
          <Button onClick={loadPackage}>Paket berikutnya</Button>
        </Card>
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
