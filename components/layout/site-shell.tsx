import Link from "next/link";
import type { Route } from "next";
import {
  BookOpen,
  BarChart3,
  History,
  Settings,
  Brain,
  ListChecks,
  Trophy
} from "lucide-react";
import { productConfig } from "@/lib/config";

const nav = [
  { href: "/memorization", label: "Latihan", icon: Brain },
  { href: "/evaluation", label: "Evaluasi", icon: ListChecks },
  { href: "/stqhn", label: "STQHN 2025", icon: Trophy },
  { href: "/reader", label: "Mushaf", icon: BookOpen },
  { href: "/analytics", label: "Analitik", icon: BarChart3 },
  { href: "/history", label: "Riwayat", icon: History },
  { href: "/settings", label: "Profil", icon: Settings }
] satisfies { href: Route; label: string; icon: typeof BookOpen }[];

export function SiteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link
            href="/"
            className="flex items-center gap-2 font-semibold text-[var(--primary)]"
          >
            <BookOpen aria-hidden className="h-5 w-5" />
            <span>{productConfig.name}</span>
          </Link>
          <nav
            aria-label="Navigasi utama"
            className="hidden items-center gap-1 md:flex"
          >
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-[var(--muted)] hover:bg-slate-100 hover:text-[var(--foreground)]"
              >
                <item.icon aria-hidden className="h-4 w-4" />
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 md:py-8">{children}</main>
      <nav
        aria-label="Navigasi bawah"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-7 border-t border-[var(--border)] bg-white md:hidden"
      >
        {nav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex flex-col items-center gap-1 px-1 py-2 text-xs"
          >
            <item.icon aria-hidden className="h-5 w-5" />
            {item.label}
          </Link>
        ))}
      </nav>
      <footer className="mx-auto max-w-6xl px-4 pb-24 pt-8 text-sm text-[var(--muted)] md:pb-8">
        <p className="font-medium text-[var(--foreground)]">
          {productConfig.fullTitle}
        </p>
        <p className="mt-1">{productConfig.tagline}</p>
      </footer>
    </div>
  );
}
