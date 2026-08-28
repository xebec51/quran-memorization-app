import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import {
  getCurrentStqhnPackage,
  getStqhnHistory,
  getStqhnSummary
} from "@/lib/memorization/stqhn/service";
import { StqhnApp } from "@/components/stqhn/stqhn-app";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

export default async function StqhnPage() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <Card>
        <h1 className="text-2xl font-semibold">STQHN 2025</h1>
        <p className="mt-2 text-[var(--muted)]">
          Masuk untuk berlatih bank soal STQHN 2025.
        </p>
        <Link href="/login">
          <Button className="mt-4">Masuk</Button>
        </Link>
      </Card>
    );
  }

  const [initialPackage, history, summary] = await Promise.all([
    getCurrentStqhnPackage(user.id),
    getStqhnHistory(user.id, null, PAGE_SIZE),
    getStqhnSummary(user.id)
  ]);

  return (
    <StqhnApp
      initialPackage={initialPackage}
      initialHistory={history}
      initialSummary={summary}
    />
  );
}
