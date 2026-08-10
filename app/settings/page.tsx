import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return (
    <Card className="max-w-xl">
      <h1 className="text-2xl font-semibold">Profil</h1>
      <dl className="mt-4 grid gap-3 text-sm">
        <div><dt className="text-[var(--muted)]">Nama</dt><dd className="font-medium">{user.name ?? "-"}</dd></div>
        <div><dt className="text-[var(--muted)]">Email</dt><dd className="font-medium">{user.email}</dd></div>
        <div><dt className="text-[var(--muted)]">Mode latihan</dt><dd className="font-medium">Expert</dd></div>
      </dl>
      <form action="/api/auth/logout" method="post" className="mt-5">
        <Button variant="secondary" type="submit"><LogOut aria-hidden className="h-4 w-4" /> Keluar</Button>
      </form>
    </Card>
  );
}
