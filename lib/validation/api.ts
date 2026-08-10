import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ data }, init);
}

export function jsonError(code: string, message: string, status = 400) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export function routeError(error: unknown) {
  if (error instanceof Response) return error;
  if (error instanceof ZodError) return jsonError("VALIDATION_ERROR", "Permintaan tidak valid.", 422);
  if (error instanceof Error && error.message.includes("Batas petunjuk")) {
    return jsonError("HINT_LIMIT", error.message, 409);
  }
  console.error(error);
  return jsonError("SERVER_ERROR", "Terjadi kesalahan pada server.", 500);
}
