import { z } from "zod";

export const productConfig = {
  name: "Tasmiq",
  fullTitle: "Tasmiq — Latihan Musabaqah Hifzhil Qur'an",
  tagline: "Uji hafalan. Kenali kelemahan. Siapkan musabaqah.",
  description:
    "Latihan Musabaqah Hifzhil Qur'an berbasis siklus 604 halaman, petunjuk progresif, dan analitik hafalan.",
  difficultyName: "Expert",
  packagesPerCycle: 151,
  questionsPerPackage: 4,
  mushafPages: 604,
  extensionLimit: 3,
  nextVerseLimit: 3
} as const;

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(32),
  APP_URL: z.string().url().default("http://localhost:3000"),
  QF_CLIENT_ID: z.string().optional(),
  QF_CLIENT_SECRET: z.string().optional(),
  QF_ENV: z.enum(["prelive", "production"]).default("prelive")
});

export function getServerEnv() {
  return envSchema.parse({
    DATABASE_URL: process.env.DATABASE_URL,
    AUTH_SECRET: process.env.AUTH_SECRET,
    APP_URL: process.env.APP_URL ?? "http://localhost:3000",
    QF_CLIENT_ID: process.env.QF_CLIENT_ID,
    QF_CLIENT_SECRET: process.env.QF_CLIENT_SECRET,
    QF_ENV: process.env.QF_ENV ?? "prelive"
  });
}
