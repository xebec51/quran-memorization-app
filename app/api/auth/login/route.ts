import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  createSessionRecord,
  sessionCookieName,
  sessionCookieOptions
} from "@/lib/auth/session";
import { credentialsSchema, verifyPassword } from "@/lib/auth/password";
import { authFormErrorCode } from "@/lib/auth/form-error";
import {
  LOGIN_MAX_ATTEMPTS,
  checkAndRecordAttempt
} from "@/lib/auth/rate-limit";
import { normalizeEmail } from "@/lib/utils";
import { jsonError, jsonOk, routeError } from "@/lib/validation/api";

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");

  try {
    const input = isJson
      ? credentialsSchema.omit({ name: true }).parse(await request.json())
      : credentialsSchema
          .omit({ name: true })
          .parse(Object.fromEntries(await request.formData()));
    const email = normalizeEmail(input.email);
    const rateLimitKey = `login:${email}`;
    await checkAndRecordAttempt(rateLimitKey, LOGIN_MAX_ATTEMPTS);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
      if (isJson) {
        return jsonError(
          "INVALID_CREDENTIALS",
          "Email atau kata sandi tidak cocok.",
          401
        );
      }
      return NextResponse.redirect(
        new URL("/login?error=invalid_credentials", request.url),
        303
      );
    }

    const session = await createSessionRecord(user.id);
    const response = isJson
      ? jsonOk({ user: { id: user.id, email: user.email, name: user.name } })
      : NextResponse.redirect(new URL("/memorization", request.url), 303);
    response.cookies.set(
      sessionCookieName,
      session.token,
      sessionCookieOptions(session.expiresAt)
    );
    return response;
  } catch (error) {
    if (isJson) return routeError(error);
    return NextResponse.redirect(
      new URL(`/login?error=${authFormErrorCode(error)}`, request.url),
      303
    );
  }
}
