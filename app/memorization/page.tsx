import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { MemorizationApp } from "@/components/memorization/memorization-app";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function MemorizationPage() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <Card>
        <h1 className="text-2xl font-semibold">Masuk untuk Latihan Expert</h1>
        <p className="mt-2 text-[var(--muted)]">Masuk untuk menyimpan siklus, riwayat, petunjuk, dan analitik hafalan.</p>
        <Link href="/login"><Button className="mt-4">Masuk</Button></Link>
      </Card>
    );
  }
  return <MemorizationApp />;
}
