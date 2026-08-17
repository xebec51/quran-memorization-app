import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { getPackageHistory } from "@/lib/memorization/history/service";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

export default async function HistoryPage({
  searchParams
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <Card>
        <p>Masuk untuk melihat riwayat.</p>
        <Link href="/login">
          <Button className="mt-4">Masuk</Button>
        </Link>
      </Card>
    );
  }

  const { cursor } = await searchParams;
  const history = await getPackageHistory(user.id, cursor ?? null, PAGE_SIZE);

  return (
    <div className="grid gap-4 pb-20">
      <h1 className="text-2xl font-semibold">Riwayat Latihan</h1>
      {history.items.length === 0 ? <Card>Belum ada riwayat latihan.</Card> : null}
      {history.items.map((pkg) => (
        <Card key={pkg.id}>
          <div className="flex flex-wrap justify-between gap-2">
            <h2 className="font-semibold">
              Siklus {pkg.cycleNumber} - Paket {pkg.packageNumber}
            </h2>
            <span className="text-sm text-[var(--muted)]">
              {pkg.state === "COMPLETED" ? "Selesai" : "Berjalan"}
            </span>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-4">
            {pkg.questions.map((question) => (
              <div
                key={question.id}
                className="rounded-md bg-slate-50 p-3 text-sm"
              >
                Soal {question.order}:{" "}
                {question.assessment
                  ? assessmentLabel(question.assessment)
                  : "Belum dinilai"}{" "}
                - {question.hints} petunjuk
              </div>
            ))}
          </div>
        </Card>
      ))}
      {history.nextCursor ? (
        <Link href={`/history?cursor=${encodeURIComponent(history.nextCursor)}`}>
          <Button variant="secondary">Muat lebih banyak</Button>
        </Link>
      ) : null}
    </div>
  );
}

function assessmentLabel(value: string) {
  if (value === "CORRECT") return "Benar";
  if (value === "PARTIAL") return "Sebagian benar";
  return "Belum ingat";
}
