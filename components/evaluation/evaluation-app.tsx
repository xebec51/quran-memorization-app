"use client";

import { useRef, useState } from "react";
import {
  AlarmClock,
  CheckCircle2,
  History,
  ListChecks,
  Repeat
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type Assessment = "CORRECT" | "PARTIAL" | "MISSED";

type BankItem = {
  questionId: string;
  fragmentText: string;
  lastResult: Assessment;
  lastAttemptAt: string | null;
};

type AttemptDto = {
  id: string;
  questionId: string;
  result: Assessment;
  belCount: number;
  tuntunCount: number;
  createdAt: string;
};

type HistoryPage = {
  items: AttemptDto[];
  nextCursor: string | null;
};

type Summary = {
  totalAttempts: number;
  totalBelCount: number;
  totalTuntunCount: number;
  resultCounts: Record<Assessment, number>;
};

async function api<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {})
  });
  const json = (await response.json()) as {
    data?: T;
    error?: { message: string };
  };
  if (!response.ok || !json.data)
    throw new Error(json.error?.message ?? "Permintaan gagal.");
  return json.data;
}

export function EvaluationApp({
  initialBank,
  initialHistory,
  initialSummary
}: {
  initialBank: BankItem[];
  initialHistory: HistoryPage;
  initialSummary: Summary;
}) {
  const [bank] = useState(initialBank);
  const [history, setHistory] = useState(initialHistory);
  const [summary, setSummary] = useState(initialSummary);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [belCount, setBelCount] = useState("0");
  const [tuntunCount, setTuntunCount] = useState("0");
  const [pending, setPending] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitLockRef = useRef(false);

  const selected = bank.find((item) => item.questionId === selectedId) ?? null;

  function selectQuestion(item: BankItem) {
    setSelectedId(item.questionId);
    setBelCount("0");
    setTuntunCount("0");
    setError(null);
  }

  async function submitAttempt(result: Assessment) {
    if (!selected || submitLockRef.current) return;
    const parsedBel = Number.parseInt(belCount, 10);
    const parsedTuntun = Number.parseInt(tuntunCount, 10);
    if (!Number.isInteger(parsedBel) || parsedBel < 0) {
      setError("Jumlah bel harus bilangan bulat 0 atau lebih.");
      return;
    }
    if (!Number.isInteger(parsedTuntun) || parsedTuntun < 0) {
      setError("Jumlah tuntun harus bilangan bulat 0 atau lebih.");
      return;
    }
    submitLockRef.current = true;
    setPending(true);
    setError(null);
    try {
      const attempt = await api<AttemptDto>("/api/evaluation/attempt", {
        questionId: selected.questionId,
        result,
        belCount: parsedBel,
        tuntunCount: parsedTuntun
      });
      setHistory((current) => ({
        items: [attempt, ...current.items],
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
      setSelectedId(null);
      setBelCount("0");
      setTuntunCount("0");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Gagal menyimpan percobaan evaluasi."
      );
    } finally {
      submitLockRef.current = false;
      setPending(false);
    }
  }

  async function loadMoreHistory() {
    if (!history.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const response = await fetch(
        `/api/evaluation/history?cursor=${encodeURIComponent(history.nextCursor)}&limit=20`
      );
      const json = (await response.json()) as {
        data?: HistoryPage & { summary: Summary };
        error?: { message: string };
      };
      if (!response.ok || !json.data)
        throw new Error(json.error?.message ?? "Gagal memuat riwayat.");
      setHistory((current) => ({
        items: [...current.items, ...json.data!.items],
        nextCursor: json.data!.nextCursor
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat riwayat.");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="grid gap-4 pb-20">
      <div>
        <h1 className="text-2xl font-semibold">Latihan Evaluasi</h1>
        <p className="mt-1 text-[var(--muted)]">
          Latih ulang soal yang belum ingat atau sebagian benar, tanpa
          mengganggu siklus 604 halaman.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Metric
          icon={ListChecks}
          label="Total percobaan"
          value={summary.totalAttempts}
        />
        <Metric
          icon={AlarmClock}
          label="Total bel"
          value={summary.totalBelCount}
        />
        <Metric
          icon={Repeat}
          label="Total tuntun"
          value={summary.totalTuntunCount}
        />
        <Metric
          icon={CheckCircle2}
          label="Benar"
          value={summary.resultCounts.CORRECT}
        />
      </div>

      {error ? (
        <Card className="text-sm text-[var(--danger)]">{error}</Card>
      ) : null}

      <Card>
        <h2 className="font-semibold">Bank Evaluasi ({bank.length})</h2>
        {bank.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted)]">
            Belum ada soal yang perlu dilatih ulang. Soal akan muncul di sini
            setelah dinilai &quot;Sebagian benar&quot; atau &quot;Belum
            ingat&quot; pada latihan utama.
          </p>
        ) : (
          <div className="mt-3 grid gap-2">
            {bank.map((item) => (
              <button
                key={item.questionId}
                onClick={() => selectQuestion(item)}
                className={`rounded-md border p-3 text-left text-sm transition ${
                  item.questionId === selectedId
                    ? "border-[var(--primary)] bg-emerald-50"
                    : "border-[var(--border)] bg-white hover:bg-slate-50"
                }`}
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      item.lastResult === "MISSED"
                        ? "bg-red-100 text-red-800"
                        : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {item.lastResult === "MISSED"
                      ? "Belum ingat"
                      : "Sebagian benar"}
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
        )}
      </Card>

      {selected ? (
        <Card className="grid gap-4 tasmiq-panel-enter">
          <div>
            <h2 className="font-semibold">Catat hasil latihan</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Ingat ayat berikut dari hafalan, lalu catat hasilnya.
            </p>
          </div>
          <p
            className="quran-text rounded-md bg-[#fbfaf4] p-4 text-right text-3xl"
            translate="no"
            lang="ar"
            dir="rtl"
          >
            {selected.fragmentText}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm font-medium">
              Jumlah bel
              <input
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={belCount}
                onChange={(event) => setBelCount(event.target.value)}
                className="rounded-md border border-[var(--border)] px-3 py-2"
              />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Jumlah tuntun
              <input
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={tuntunCount}
                onChange={(event) => setTuntunCount(event.target.value)}
                className="rounded-md border border-[var(--border)] px-3 py-2"
              />
            </label>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Button disabled={pending} onClick={() => submitAttempt("CORRECT")}>
              <CheckCircle2 aria-hidden className="h-4 w-4" /> Benar
            </Button>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => submitAttempt("PARTIAL")}
            >
              Sebagian benar
            </Button>
            <Button
              variant="danger"
              disabled={pending}
              onClick={() => submitAttempt("MISSED")}
            >
              Belum ingat
            </Button>
          </div>
        </Card>
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
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Bel: {attempt.belCount} - Tuntun: {attempt.tuntunCount}
                </p>
              </div>
            ))}
          </div>
        )}
        {history.nextCursor ? (
          <Button
            variant="secondary"
            className="mt-3"
            disabled={loadingMore}
            onClick={loadMoreHistory}
          >
            {loadingMore ? "Memuat..." : "Muat lebih banyak"}
          </Button>
        ) : null}
      </Card>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value
}: {
  icon: typeof ListChecks;
  label: string;
  value: number;
}) {
  return (
    <Card>
      <div className="flex items-center gap-2 text-[var(--muted)]">
        <Icon aria-hidden className="h-4 w-4" />
        <p className="text-sm">{label}</p>
      </div>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </Card>
  );
}

function resultLabel(result: Assessment) {
  if (result === "CORRECT") return "Benar";
  if (result === "PARTIAL") return "Sebagian benar";
  return "Belum ingat";
}
