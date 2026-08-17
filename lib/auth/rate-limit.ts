import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";

const WINDOW_MS = 10 * 60 * 1000;
export const LOGIN_MAX_ATTEMPTS = 10;
// Registration has no per-account target to protect (unlike login, where
// each attempt targets one email) - this is purely an anti-spam-signup
// throttle per IP, so it can afford to be generous. Sized with headroom
// above the e2e suite's real registration volume (~12 per project run,
// several projects/reruns can land in the same 10-minute window) rather
// than the tighter number that would suffice for a single run alone.
export const REGISTER_MAX_ATTEMPTS = 100;

export class RateLimitedError extends Error {
  retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("Terlalu banyak percobaan. Coba lagi nanti.");
    this.name = "RateLimitedError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Atomically increments the attempt counter for `key` and enforces
 * `maxAttempts` within a rolling WINDOW_MS window, in one round trip.
 *
 * The window-expired-reset-vs-increment decision happens inside the same
 * INSERT ... ON CONFLICT statement, serialized by Postgres's row lock on
 * the upserted row - so two concurrent requests against the same key can
 * never both read a pre-increment count (the check-then-increment race
 * that let bursts bypass the limit) and can never both decide "window
 * expired, reset to 1" independently (the race that silently lost an
 * attempt at each window boundary). Every attempt against `key` - not just
 * failures - counts toward the limit, so the limit is enforced *before*
 * any expensive work (e.g. password verification) runs for that request.
 */
export async function checkAndRecordAttempt(key: string, maxAttempts: number) {
  const [row] = await prisma.$queryRaw<
    { attemptCount: number; windowStart: Date }[]
  >(Prisma.sql`
    INSERT INTO "AuthRateLimit" ("id", "key", "windowStart", "attemptCount", "updatedAt")
    VALUES (${randomUUID()}, ${key}, now(), 1, now())
    ON CONFLICT ("key") DO UPDATE SET
      "windowStart" = CASE
        WHEN "AuthRateLimit"."windowStart" <= now() - (${WINDOW_MS} * interval '1 millisecond')
        THEN now()
        ELSE "AuthRateLimit"."windowStart"
      END,
      "attemptCount" = CASE
        WHEN "AuthRateLimit"."windowStart" <= now() - (${WINDOW_MS} * interval '1 millisecond')
        THEN 1
        ELSE "AuthRateLimit"."attemptCount" + 1
      END,
      "updatedAt" = now()
    RETURNING "attemptCount", "windowStart"
  `);

  if (row.attemptCount > maxAttempts) {
    const elapsedMs = Date.now() - row.windowStart.getTime();
    const retryAfterSeconds = Math.max(1, Math.ceil((WINDOW_MS - elapsedMs) / 1000));
    throw new RateLimitedError(retryAfterSeconds);
  }
}

export function clientIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const first = forwardedFor?.split(",")[0]?.trim();
  return first || request.headers.get("x-real-ip") || "unknown";
}
