import type { Metadata, Viewport } from "next";
import "./globals.css";
import { productConfig } from "@/lib/config";
import { SiteShell } from "@/components/layout/site-shell";

export const metadata: Metadata = {
  title: productConfig.name,
  description: "Latihan hafalan Al-Quran mode Expert dengan siklus 604 halaman dan petunjuk progresif.",
  other: {
    google: "notranslate"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" translate="no">
      <body>
        <SiteShell>{children}</SiteShell>
      </body>
    </html>
  );
}
