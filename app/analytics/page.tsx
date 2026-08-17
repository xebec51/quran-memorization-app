import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { getAnalytics } from "@/lib/memorization/analytics/service";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <Card>
        <p>Masuk untuk melihat analitik hafalan.</p>
        <Link href="/login">
          <Button className="mt-4">Masuk</Button>
        </Link>
      </Card>
    );
  }
  const data = await getAnalytics(user.id);
  return (
    <div className="grid gap-4 pb-20">
      <div className="flex items-center gap-2">
        <BarChart3 aria-hidden className="h-6 w-6 text-[var(--primary)]" />
        <h1 className="text-2xl font-semibold">Analitik</h1>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="Siklus" value={data.cycleNumber} />
        <Metric label="Halaman diuji" value={`${data.pagesTested}/604`} />
        <Metric label="Paket selesai" value={`${data.packagesCompleted}/151`} />
        <Metric label="Total soal" value={data.totalQuestions} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="font-semibold">Penilaian mandiri</h2>
          <List
            rows={data.assessmentDistribution.map((item) => [
              assessmentLabel(item.assessment),
              item.count
            ])}
            empty="Belum ada penilaian."
          />
        </Card>
        <Card>
          <h2 className="font-semibold">Penggunaan petunjuk</h2>
          <List
            rows={data.hintUsage.map((item) => [
              hintLabel(item.type),
              item.count
            ])}
            empty="Belum ada petunjuk."
          />
        </Card>
      </div>
      <Card>
        <h2 className="font-semibold">Kinerja per rentang juz</h2>
        <div className="mt-3 grid gap-2">
          {data.bandPerformance.map((band) => (
            <div key={band.band} className="rounded-md bg-slate-50 p-3 text-sm">
              Rentang {band.band}: {band.attempts} soal, {band.correct} benar,{" "}
              {band.hints} petunjuk
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <h2 className="font-semibold">Halaman yang perlu perhatian</h2>
        <List
          rows={data.weakestPages.map((page) => [
            `Halaman ${page.page}`,
            `${page.attempts} percobaan · ${page.hints} petunjuk · ${page.misses} belum ingat`
          ])}
          empty="Butuh minimal dua percobaan per halaman untuk menghitung kelemahan."
        />
      </Card>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <p className="text-sm text-[var(--muted)]">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </Card>
  );
}

function List({
  rows,
  empty
}: {
  rows: [string, string | number][];
  empty: string;
}) {
  if (rows.length === 0)
    return <p className="mt-2 text-sm text-[var(--muted)]">{empty}</p>;
  return (
    <ul className="mt-3 grid gap-2">
      {rows.map(([label, value]) => (
        <li
          key={label}
          className="flex justify-between gap-3 rounded-md bg-slate-50 p-3 text-sm"
        >
          <span>{label}</span>
          <span className="font-medium">{value}</span>
        </li>
      ))}
    </ul>
  );
}

function assessmentLabel(value: string) {
  if (value === "CORRECT") return "Benar";
  if (value === "PARTIAL") return "Sebagian benar";
  return "Belum ingat";
}

function hintLabel(value: string) {
  if (value === "JUZ") return "Juz";
  if (value === "SURAH") return "Surah";
  if (value === "EXTEND_FRAGMENT") return "Tambah fragmen";
  return "Ayat berikutnya";
}
