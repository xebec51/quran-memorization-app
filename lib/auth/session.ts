import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { measureServerTiming } from "@/lib/performance/timing";

export const sessionCookieName = "qma_session";
const sessionDays = 30;
const sessionTouchIntervalMs = 15 * 60 * 1000;

export type AuthUser = {
  id: string;
  email: string;
  name: string | null;
};

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt
  };
}

export async function createSessionRecord(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionDays * 24 * 60 * 60 * 1000);
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt
    }
  });
  return { token, expiresAt };
}

export async function createSession(userId: string) {
  const { token, expiresAt } = await createSessionRecord(userId);

  const cookieStore = await cookies();
  cookieStore.set(sessionCookieName, token, sessionCookieOptions(expiresAt));
}

export async function destroySession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName)?.value;
  if (token) {
    await prisma.session.deleteMany({
      where: { tokenHash: hashSessionToken(token) }
    });
  }
  cookieStore.delete(sessionCookieName);
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  return measureServerTiming("auth_session", async () => {
    const cookieStore = await cookies();
    const token = cookieStore.get(sessionCookieName)?.value;
    if (!token) return null;

    const tokenHash = hashSessionToken(token);
    const session = await prisma.session.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        tokenHash: true,
        expiresAt: true,
        lastSeenAt: true,
        user: {
          select: {
            id: true,
            email: true,
            name: true
          }
        }
      }
    });

    const now = new Date();
    if (!session || session.expiresAt < now) {
      if (session) await prisma.session.delete({ where: { id: session.id } });
      return null;
    }

    const hashA = Buffer.from(tokenHash);
    const hashB = Buffer.from(session.tokenHash);
    if (hashA.length !== hashB.length || !timingSafeEqual(hashA, hashB))
      return null;

    if (
      now.getTime() - session.lastSeenAt.getTime() >=
      sessionTouchIntervalMs
    ) {
      await prisma.session.update({
        where: { id: session.id },
        data: { lastSeenAt: now },
        select: { id: true }
      });
    }

    return {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name
    };
  });
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) {
    throw new Response(
      JSON.stringify({
        error: {
          code: "UNAUTHORIZED",
          message: "Silakan masuk terlebih dahulu."
        }
      }),
      {
        status: 401,
        headers: { "content-type": "application/json" }
      }
    );
  }
  return user;
}
