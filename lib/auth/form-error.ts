import { ZodError } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { RateLimitedError } from "@/lib/auth/rate-limit";

export type AuthFormErrorCode =
  | "invalid_credentials"
  | "invalid_input"
  | "email_taken"
  | "rate_limited"
  | "server_error";

export function authFormErrorCode(error: unknown): AuthFormErrorCode {
  if (error instanceof ZodError) return "invalid_input";
  if (error instanceof RateLimitedError) return "rate_limited";
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    return "email_taken";
  }
  return "server_error";
}

const MESSAGES: Record<AuthFormErrorCode, string> = {
  invalid_credentials: "Email atau kata sandi tidak cocok.",
  invalid_input: "Periksa kembali data yang Anda masukkan.",
  email_taken: "Email sudah terdaftar. Silakan masuk.",
  rate_limited: "Terlalu banyak percobaan. Coba lagi beberapa menit lagi.",
  server_error: "Terjadi kesalahan pada server. Coba lagi."
};

export function authFormErrorMessage(code: string | undefined) {
  if (!code) return null;
  return MESSAGES[code as AuthFormErrorCode] ?? MESSAGES.server_error;
}
