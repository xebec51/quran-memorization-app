import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { createSessionRecord, sessionCookieName, sessionCookieOptions } from "@/lib/auth/session";
import { credentialsSchema, hashPassword } from "@/lib/auth/password";
import { authFormErrorCode } from "@/lib/auth/form-error";
import { REGISTER_MAX_ATTEMPTS, checkRateLimit, clientIp, recordAttempt } from "@/lib/auth/rate-limit";
import { normalizeEmail } from "@/lib/utils";
import { jsonOk, routeError } from "@/lib/validation/api";

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");

  try {
    const rateLimitKey = `register:${clientIp(request)}`;
    await checkRateLimit(rateLimitKey, REGISTER_MAX_ATTEMPTS);
    await recordAttempt(rateLimitKey);

    const input = isJson
      ? credentialsSchema.parse(await request.json())
      : credentialsSchema.parse(Object.fromEntries(await request.formData()));
    const user = await prisma.user.create({
      data: {
        email: normalizeEmail(input.email),
        name: input.name,
        passwordHash: await hashPassword(input.password)
      },
      select: { id: true, email: true, name: true }
    });
    const session = await createSessionRecord(user.id);
    const response = isJson
      ? jsonOk({ user })
      : NextResponse.redirect(new URL("/memorization", request.url), 303);
    response.cookies.set(sessionCookieName, session.token, sessionCookieOptions(session.expiresAt));
    return response;
  } catch (error) {
    if (isJson) return routeError(error);
    return NextResponse.redirect(
      new URL(`/register?error=${authFormErrorCode(error)}`, request.url),
      303
    );
  }
}
