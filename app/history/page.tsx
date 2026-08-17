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
      {history.items.length === 0 ? (
        <Card>Belum ada riwayat latihan.</Card>
      ) : null}
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
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {pkg.questions.map((question) => (
              <details
                key={question.id}
                className="rounded-md bg-slate-50 p-3 text-sm open:bg-white open:ring-1 open:ring-[var(--border)]"
              >
                <summary className="cursor-pointer list-none">
                  Soal {question.order}:{" "}
                  {question.assessment
                    ? assessmentLabel(question.assessment)
                    : "Belum dinilai"}{" "}
                  - {question.hints} petunjuk
                  {question.belCount !== null &&
                  question.tuntunCount !== null ? (
                    <>
                      {" "}
                      (bel {question.belCount}, tuntun {question.tuntunCount})
                    </>
                  ) : null}
                </summary>
                {question.fragmentText ? (
                  <div className="mt-3 grid gap-3 border-t border-[var(--border)] pt-3">
                    <div>
                      <p className="text-xs text-[var(--muted)]">Soal:</p>
                      <p
                        className="quran-text text-right text-2xl"
                        translate="no"
                        lang="ar"
                        dir="rtl"
                      >
                        {question.fragmentText}
                      </p>
                    </div>
                    {question.revealedVerses?.length ? (
                      <div className="grid gap-2">
                        <p className="text-xs text-[var(--muted)]">
                          Jawaban ({question.revealedVerses.length} ayat):
                        </p>
                        {question.revealedVerses.map((verse) => (
                          <div key={verse.verseKey} className="grid gap-1">
                            <p className="text-xs text-[var(--muted)]">
                              {verse.surah} - {verse.verseKey}
                            </p>
                            <p
                              className="quran-text text-right text-xl"
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
                  </div>
                ) : (
                  <p className="mt-3 border-t border-[var(--border)] pt-3 text-[var(--muted)]">
                    Belum dinilai - jawaban belum tersedia untuk dibuka.
                  </p>
                )}
              </details>
            ))}
          </div>
        </Card>
      ))}
      {history.nextCursor ? (
        // This is a plain server-rendered navigation (no client JS), so it
        // replaces the list rather than appending to it - "Halaman
        // berikutnya" describes that correctly. Do not relabel this
        // "Muat lebih banyak" (load more): that label belongs to an
        // appending list, like components/evaluation/evaluation-app.tsx's
        // loadMoreHistory, which this page deliberately is not.
        <Link
          href={`/history?cursor=${encodeURIComponent(history.nextCursor)}`}
        >
          <Button variant="secondary">Halaman berikutnya →</Button>
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
