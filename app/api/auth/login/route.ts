import { prisma } from "@/lib/db/prisma";
import { createSessionRecord, sessionCookieName, sessionCookieOptions } from "@/lib/auth/session";
import { credentialsSchema, verifyPassword } from "@/lib/auth/password";
import { normalizeEmail } from "@/lib/utils";
import { jsonError, jsonOk, routeError } from "@/lib/validation/api";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    const input =
      contentType.includes("application/json")
        ? credentialsSchema.omit({ name: true }).parse(await request.json())
        : credentialsSchema.omit({ name: true }).parse(Object.fromEntries(await request.formData()));
    const user = await prisma.user.findUnique({ where: { email: normalizeEmail(input.email) } });
    if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
      return jsonError("INVALID_CREDENTIALS", "Email atau kata sandi tidak cocok.", 401);
    }
    const session = await createSessionRecord(user.id);
    const response = contentType.includes("application/json")
      ? jsonOk({ user: { id: user.id, email: user.email, name: user.name } })
      : NextResponse.redirect(new URL("/memorization", request.url));
    response.cookies.set(sessionCookieName, session.token, sessionCookieOptions(session.expiresAt));
    return response;
  } catch (error) {
    return routeError(error);
  }
}
