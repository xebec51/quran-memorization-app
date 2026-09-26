import Link from "next/link";
import { ArrowRight, Brain, ShieldCheck, Layers3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { productConfig } from "@/lib/config";

export default function HomePage() {
  return (
    <div className="grid gap-8 pb-20 md:grid-cols-[1.15fr_0.85fr] md:items-center">
      <section className="py-6 md:py-12">
        <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--accent)]">
          Latihan hafalan
        </p>
        <h1 className="max-w-3xl text-4xl font-semibold leading-tight md:text-6xl">
          {productConfig.fullTitle}
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-[var(--muted)]">
          {productConfig.tagline} Pilih cakupan 10, 20, atau 30 Juz dengan
          siklus halaman utama tanpa pengulangan.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link href="/memorization">
            <Button>
              Mulai Latihan <ArrowRight aria-hidden className="h-4 w-4" />
            </Button>
          </Link>
          <Link href="/reader">
            <Button variant="secondary">Buka Mushaf</Button>
          </Link>
        </div>
      </section>
      <section className="grid gap-3">
        {[
          {
            icon: Brain,
            title: "Kategori fleksibel",
            text: "Latihan utama bisa dijalankan untuk 10, 20, atau 30 Juz dengan distribusi soal yang sesuai."
          },
          {
            icon: Layers3,
            title: "Siklus tanpa ulang",
            text: "Halaman utama tidak berulang sampai seluruh cakupan kategori selesai."
          },
          {
            icon: ShieldCheck,
            title: "Petunjuk independen",
            text: "Minta Juz, Surah, lanjutan fragmen, atau ayat berikutnya tanpa urutan paksa."
          }
        ].map((item) => (
          <Card key={item.title} className="flex gap-4">
            <item.icon
              aria-hidden
              className="mt-1 h-5 w-5 shrink-0 text-[var(--primary)]"
            />
            <div>
              <h2 className="font-semibold">{item.title}</h2>
              <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
                {item.text}
              </p>
            </div>
          </Card>
        ))}
      </section>
    </div>
  );
}
