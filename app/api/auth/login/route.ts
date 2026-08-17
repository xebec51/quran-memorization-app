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
  LOGIN_IP_MAX_ATTEMPTS,
  checkAndRecordAttempt,
  clientIp,
  recordLoginFailure,
  resetLoginFailures
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

    // Per-IP gate first, before any expensive work: bounds how many
    // login attempts a single source can throw at the endpoint at all,
    // regardless of which account(s) it targets.
    await checkAndRecordAttempt(
      `login-ip:${clientIp(request)}`,
      LOGIN_IP_MAX_ATTEMPTS
    );

    const user = await prisma.user.findUnique({ where: { email } });
    const valid =
      user && (await verifyPassword(input.password, user.passwordHash));

    if (!valid) {
      // Only failures count toward the per-account threshold - see
      // recordLoginFailure. This can itself throw RateLimitedError once
      // the account has accumulated too many wrong attempts, but a
      // correct password (the `valid` branch below) is never gated on
      // this counter, so the real owner is never locked out by someone
      // else's guesses.
      await recordLoginFailure(email);
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

    // A correct password proves this is the real owner - clear any
    // failure history (their own mistypes, or an attacker's guesses)
    // rather than letting it linger toward a future false lockout.
    await resetLoginFailures(email);

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
