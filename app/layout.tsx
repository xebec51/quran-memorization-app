import type { Metadata, Viewport } from "next";
import "./globals.css";
import { productConfig } from "@/lib/config";
import { SiteShell } from "@/components/layout/site-shell";

export const metadata: Metadata = {
  title: {
    default: productConfig.fullTitle,
    template: `%s · ${productConfig.name}`
  },
  applicationName: productConfig.name,
  description: productConfig.description,
  openGraph: {
    title: productConfig.fullTitle,
    description: productConfig.tagline,
    siteName: productConfig.name,
    locale: "id_ID",
    type: "website"
  },
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
