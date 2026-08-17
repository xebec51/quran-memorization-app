import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { RateLimitedError } from "@/lib/auth/rate-limit";

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ data }, init);
}

export function jsonError(code: string, message: string, status = 400, init?: ResponseInit) {
  return NextResponse.json({ error: { code, message } }, { ...init, status });
}

export function routeError(error: unknown) {
  if (error instanceof Response) return error;
  if (error instanceof ZodError) return jsonError("VALIDATION_ERROR", "Permintaan tidak valid.", 422);
  if (error instanceof RateLimitedError) {
    return jsonError("RATE_LIMITED", error.message, 429, {
      headers: { "Retry-After": String(error.retryAfterSeconds) }
    });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return jsonError("CONFLICT", "Data sudah ada.", 409);
  }
  if (error instanceof Error && error.message.includes("Batas petunjuk")) {
    return jsonError("HINT_LIMIT", error.message, 409);
  }
  console.error(error);
  return jsonError("SERVER_ERROR", "Terjadi kesalahan pada server.", 500);
}
