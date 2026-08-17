import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import {
  getEvaluationBank,
  getEvaluationHistory,
  getEvaluationSummary
} from "@/lib/memorization/evaluation/service";
import { EvaluationApp } from "@/components/evaluation/evaluation-app";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function EvaluationPage() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <Card>
        <h1 className="text-2xl font-semibold">Latihan Evaluasi</h1>
        <p className="mt-2 text-[var(--muted)]">
          Masuk untuk berlatih soal yang belum ingat atau sebagian benar.
        </p>
        <Link href="/login">
          <Button className="mt-4">Masuk</Button>
        </Link>
      </Card>
    );
  }

  const [bank, history, summary] = await Promise.all([
    getEvaluationBank(user.id),
    getEvaluationHistory(user.id, null, 20),
    getEvaluationSummary(user.id)
  ]);

  return (
    <EvaluationApp
      initialBank={bank}
      initialHistory={history}
      initialSummary={summary}
    />
  );
}
