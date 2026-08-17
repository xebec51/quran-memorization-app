"use client";

import { useRef, useState } from "react";
import {
  AlarmClock,
  CheckCircle2,
  Eye,
  History,
  ListChecks,
  Repeat
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { apiFetch } from "@/lib/client/api";

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
  const [belCount, setBelCount] = useState("0");
  const [tuntunCount, setTuntunCount] = useState("0");
  const [sessionLoading, setSessionLoading] = useState(false);
  const [revealPending, setRevealPending] = useState(false);
  const [submitPending, setSubmitPending] = useState(false);
  const [loadingMoreBank, setLoadingMoreBank] = useState(false);
  const [loadingMoreHistory, setLoadingMoreHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitLockRef = useRef(false);
  const revealLockRef = useRef(false);
  // One key per selected question, reused across retries of the same
  // submission (double-click, dropped response) so the server can dedupe -
  // see submitEvaluationAttempt. A fresh key is only drawn on selection.
  const attemptKeyRef = useRef<string>(crypto.randomUUID());

  async function selectQuestion(item: BankItem) {
    setSelectedId(item.questionId);
    setSession(null);
    setBelCount("0");
    setTuntunCount("0");
    setError(null);
    attemptKeyRef.current = crypto.randomUUID();
    setSessionLoading(true);
    try {
      const data = await apiFetch<SessionDto>("/api/evaluation/session", {
        questionId: item.questionId
      });
      setSession(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Gagal memuat sesi latihan."
      );
      setSelectedId(null);
    } finally {
      setSessionLoading(false);
    }
  }

  async function revealNext() {
    if (!session || revealLockRef.current || session.isComplete) return;
    revealLockRef.current = true;
    setRevealPending(true);
    try {
      const data = await apiFetch<SessionDto>("/api/evaluation/reveal", {
        questionId: session.questionId,
        expectedRevealedCount: session.revealedAyahCount
      });
      setSession(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Gagal membuka ayat berikutnya."
      );
    } finally {
      revealLockRef.current = false;
      setRevealPending(false);
    }
  }

  async function submitAttempt(result: Assessment) {
    if (!session || !session.isComplete || submitLockRef.current) return;
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
    setSubmitPending(true);
    setError(null);
    try {
      const attempt = await apiFetch<AttemptDto>("/api/evaluation/attempt", {
        questionId: session.questionId,
        result,
        belCount: parsedBel,
        tuntunCount: parsedTuntun,
        clientRequestId: attemptKeyRef.current
      });
      // A deduped retry (server returned the attempt already created by an
      // earlier try with the same clientRequestId) must not be counted or
      // listed twice on the client either.
      const alreadyRecorded = history.items.some(
        (item) => item.id === attempt.id
      );
      if (!alreadyRecorded) {
        setHistory((current) => ({
          items: [
            { ...attempt, fragmentText: session.fragmentText },
            ...current.items
          ],
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
      }
      setSelectedId(null);
      setSession(null);
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
      setSubmitPending(false);
    }
  }

  async function loadMoreBank() {
    if (!bank.nextCursor || loadingMoreBank) return;
    setLoadingMoreBank(true);
    try {
      const page = await apiFetch<BankPage>(
        `/api/evaluation/bank?cursor=${encodeURIComponent(bank.nextCursor)}&limit=20`,
        undefined,
        { method: "GET" }
      );
      setBank((current) => ({
        items: [...current.items, ...page.items],
        nextCursor: page.nextCursor
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat bank soal.");
    } finally {
      setLoadingMoreBank(false);
    }
  }

  async function loadMoreHistory() {
    if (!history.nextCursor || loadingMoreHistory) return;
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
      setError(err instanceof Error ? err.message : "Gagal memuat riwayat.");
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
        <Card role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </Card>
      ) : null}

      <Card>
        <h2 className="font-semibold">Bank Evaluasi</h2>
        {bank.items.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted)]">
            Belum ada soal yang perlu dilatih ulang. Soal akan muncul di sini
            setelah dinilai &quot;Sebagian benar&quot; atau &quot;Belum
            ingat&quot; pada latihan utama.
          </p>
        ) : (
          <div className="mt-3 grid gap-2">
            {bank.items.map((item) => (
              <button
                key={item.questionId}
                onClick={() => selectQuestion(item)}
                disabled={sessionLoading}
                aria-label={`Latih soal ${item.lastResult === "MISSED" ? "belum ingat" : "sebagian benar"}`}
                className={`rounded-md border p-3 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-70 ${
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

      {selectedId && (sessionLoading || session) ? (
        <Card className="grid gap-4 tasmiq-panel-enter">
          <div>
            <h2 className="font-semibold">Latihan ingatan</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Ingat ayat berikut dari hafalan, buka satu per satu untuk
              memeriksa, lalu catat hasilnya.
            </p>
          </div>
          {sessionLoading || !session ? (
            <p className="text-sm text-[var(--muted)]">Memuat sesi...</p>
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

              {!session.isComplete ? (
                <Button onClick={revealNext} disabled={revealPending}>
                  <Eye aria-hidden className="h-4 w-4" /> {revealButtonLabel}
                </Button>
              ) : null}

              {session.verses.length > 0 ? (
                <div className="grid gap-3 rounded-md border border-[var(--border)] p-4 tasmiq-panel-enter">
                  <p className="text-sm text-[var(--muted)]">
                    Ayat {session.revealedAyahCount}/{session.totalAyahCount}{" "}
                    terbuka
                    {session.isComplete ? " - halaman ini selesai" : ""}
                  </p>
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
                </div>
              ) : null}

              {session.isComplete ? (
                <>
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
                    <Button
                      disabled={submitPending}
                      onClick={() => submitAttempt("CORRECT")}
                    >
                      <CheckCircle2 aria-hidden className="h-4 w-4" /> Benar
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={submitPending}
                      onClick={() => submitAttempt("PARTIAL")}
                    >
                      Sebagian benar
                    </Button>
                    <Button
                      variant="danger"
                      disabled={submitPending}
                      onClick={() => submitAttempt("MISSED")}
                    >
                      Belum ingat
                    </Button>
                  </div>
                </>
              ) : null}
            </>
          )}
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
                <p
                  className="quran-text mt-1 text-right text-base"
                  translate="no"
                  lang="ar"
                  dir="rtl"
                >
                  {attempt.fragmentText}
                </p>
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
