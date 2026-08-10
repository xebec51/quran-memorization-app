import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const user = await getCurrentUser();
  if (!user) return <Card><p>Masuk untuk melihat riwayat.</p><Link href="/login"><Button className="mt-4">Masuk</Button></Link></Card>;
  const packages = await prisma.memorizationPackage.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 30,
    include: { cycle: true, questions: { include: { assessment: true, hintEvents: true }, orderBy: { orderInPackage: "asc" } } }
  });
  return (
    <div className="grid gap-4 pb-20">
      <h1 className="text-2xl font-semibold">Riwayat Latihan</h1>
      {packages.length === 0 ? <Card>Belum ada riwayat latihan.</Card> : null}
      {packages.map((pkg) => (
        <Card key={pkg.id}>
          <div className="flex flex-wrap justify-between gap-2">
            <h2 className="font-semibold">Siklus {pkg.cycle.cycleNumber} · Paket {pkg.packageNumber}</h2>
            <span className="text-sm text-[var(--muted)]">{pkg.state === "COMPLETED" ? "Selesai" : "Berjalan"}</span>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-4">
            {pkg.questions.map((question) => (
              <div key={question.id} className="rounded-md bg-slate-50 p-3 text-sm">
                Soal {question.orderInPackage}: {question.assessment ? assessmentLabel(question.assessment.assessment) : "Belum dinilai"} · {question.hintEvents.length} petunjuk
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

function assessmentLabel(value: string) {
  if (value === "CORRECT") return "Benar";
  if (value === "PARTIAL") return "Sebagian benar";
  return "Belum ingat";
}
