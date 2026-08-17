import "server-only";
import { prisma } from "@/lib/db/prisma";

const WINDOW_MS = 10 * 60 * 1000;
export const LOGIN_MAX_ATTEMPTS = 10;
export const REGISTER_MAX_ATTEMPTS = 30;

export class RateLimitedError extends Error {
  retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("Terlalu banyak percobaan. Coba lagi nanti.");
    this.name = "RateLimitedError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export async function checkRateLimit(key: string, maxAttempts: number) {
  const record = await prisma.authRateLimit.findUnique({ where: { key } });
  if (!record) return;
  const elapsedMs = Date.now() - record.windowStart.getTime();
  if (elapsedMs >= WINDOW_MS) return;
  if (record.attemptCount >= maxAttempts) {
    throw new RateLimitedError(Math.ceil((WINDOW_MS - elapsedMs) / 1000));
  }
}

export async function recordAttempt(key: string) {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const record = await tx.authRateLimit.findUnique({ where: { key } });
    const elapsedMs = record
      ? now.getTime() - record.windowStart.getTime()
      : Infinity;
    if (!record || elapsedMs >= WINDOW_MS) {
      await tx.authRateLimit.upsert({
        where: { key },
        update: { windowStart: now, attemptCount: 1 },
        create: { key, windowStart: now, attemptCount: 1 }
      });
      return;
    }
    await tx.authRateLimit.update({
      where: { key },
      data: { attemptCount: { increment: 1 } }
    });
  });
}

export function clientIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const first = forwardedFor?.split(",")[0]?.trim();
  return first || request.headers.get("x-real-ip") || "unknown";
}
