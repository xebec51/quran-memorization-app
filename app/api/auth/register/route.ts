import { prisma } from "@/lib/db/prisma";
import { createSessionRecord, sessionCookieName, sessionCookieOptions } from "@/lib/auth/session";
import { credentialsSchema, hashPassword } from "@/lib/auth/password";
import { normalizeEmail } from "@/lib/utils";
import { jsonOk, routeError } from "@/lib/validation/api";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    const input =
      contentType.includes("application/json")
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
    const response = contentType.includes("application/json")
      ? jsonOk({ user })
      : NextResponse.redirect(new URL("/memorization", request.url));
    response.cookies.set(sessionCookieName, session.token, sessionCookieOptions(session.expiresAt));
    return response;
  } catch (error) {
    return routeError(error);
  }
}
