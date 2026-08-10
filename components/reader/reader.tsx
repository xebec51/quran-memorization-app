"use client";

import { useCallback, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type ReaderData = {
  chapters: { id: number; nameTransliterated: string; nameArabic: string }[];
  verses: {
    verseKey: string;
    textUthmani: string;
    chapter: string;
    chapterArabic: string;
    verseNumber: number;
    juzNumber: number;
    pageNumber: number;
  }[];
};

export function Reader() {
  const [mode, setMode] = useState("page");
  const [value, setValue] = useState(1);
  const [data, setData] = useState<ReaderData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const response = await fetch(`/api/reader?mode=${mode}&value=${value}`);
    const json = (await response.json()) as { data?: ReaderData; error?: { message: string } };
    if (!response.ok || !json.data) {
      setError(json.error?.message ?? "Gagal memuat mushaf.");
      return;
    }
    setData(json.data);
  }, [mode, value]);

  return (
    <div className="grid gap-4 pb-20">
      <div>
        <h1 className="text-2xl font-semibold">Mushaf</h1>
        <p className="mt-1 text-[var(--muted)]">Baca berdasarkan surah, juz, atau halaman Madani Mushaf.</p>
      </div>
      <Card className="grid gap-3 sm:grid-cols-[160px_1fr_auto]">
        <label className="grid gap-1 text-sm font-medium">
          Navigasi
          <select value={mode} onChange={(event) => setMode(event.target.value)} className="rounded-md border border-[var(--border)] px-3 py-2">
            <option value="page">Halaman</option>
            <option value="surah">Surah</option>
            <option value="juz">Juz</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Nomor
          <input value={value} min={1} max={mode === "page" ? 604 : mode === "surah" ? 114 : 30} type="number" onChange={(event) => setValue(Number(event.target.value))} className="rounded-md border border-[var(--border)] px-3 py-2" />
        </label>
        <Button className="self-end" onClick={load}><Search aria-hidden className="h-4 w-4" /> Buka</Button>
      </Card>
      {error ? <Card className="text-[var(--danger)]">{error}</Card> : null}
      <div className="grid gap-3">
        {data?.verses.length === 0 ? <Card>Data Quran belum tersedia. Jalankan `npm run quran:sync`.</Card> : null}
        {data?.verses.map((verse) => (
          <Card key={verse.verseKey}>
            <div className="mb-3 flex flex-wrap justify-between gap-2 text-sm text-[var(--muted)]">
              <span>{verse.chapter} · {verse.verseKey}</span>
              <span>Juz {verse.juzNumber} · Halaman {verse.pageNumber}</span>
            </div>
            <p className="quran-text text-right text-3xl" translate="no" lang="ar" dir="rtl">{verse.textUthmani}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
