import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";

const WINDOW_MS = 10 * 60 * 1000;

// Per-IP: gates EVERY login attempt (success or failure) from one
// source, atomically, BEFORE any expensive work (bcrypt) runs. This is a
// hard, early block - safe to be, because IP-scoped failures are
// entirely within one actor's control. It is the primary defense against
// a single source brute-forcing or flooding the login endpoint. Sized
// well above LOGIN_ACCOUNT_MAX_FAILURES (the meaningful per-target
// protection) so this layer only trips for genuine flooding, not for a
// handful of dedicated per-account security e2e tests - and it stays at
// this production-appropriate value regardless of test volume: local
// e2e has no real proxy in front of it, so clientIp() (see below) would
// otherwise resolve to the literal string "unknown" for every local
// request, sharing one counter across every Playwright project/test. The
// fix for that is giving each rate-limit-sensitive e2e scenario its own
// synthetic x-forwarded-for value (see tests/e2e/auth-security.spec.ts),
// not loosening this production threshold to accommodate test traffic.
export const LOGIN_IP_MAX_ATTEMPTS = 60;

// Per-account: counts login FAILURES only (never successes - see
// resetLoginFailures) and is scoped to the target email, not the caller.
// Deliberately NEVER used to skip password verification (see the login
// route): a request with the CORRECT password always succeeds no matter
// how many prior wrong attempts exist for that email, so an attacker who
// only knows a victim's email and spams wrong passwords can never lock
// the real owner out of their own account - crossing this threshold only
// starts throttling further WRONG-password attempts.
export const LOGIN_ACCOUNT_MAX_FAILURES = 10;

// Registration has no account to protect (it doesn't exist yet) - purely
// an anti-spam-signup throttle per IP, so it can afford to be generous.
// Sized with headroom above the e2e suite's real registration volume
// (~12 per project run, several projects/reruns can land in the same
// 10-minute window) rather than the tighter number a single run needs.
export const REGISTER_IP_MAX_ATTEMPTS = 100;

export class RateLimitedError extends Error {
  retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("Terlalu banyak percobaan. Coba lagi nanti.");
    this.name = "RateLimitedError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Atomically increments the counter for `key` and enforces `maxAttempts`
 * within a rolling WINDOW_MS window, in one round trip.
 *
 * The window-expired-reset-vs-increment decision happens inside the same
 * INSERT ... ON CONFLICT statement, serialized by Postgres's row lock on
 * the upserted row - so two concurrent requests against the same key can
 * never both read a pre-increment count (the check-then-increment race
 * that let bursts bypass the limit) and can never both decide "window
 * expired, reset to 1" independently (the race that silently lost an
 * attempt at each window boundary).
 */
async function atomicIncrementAndCheck(key: string, maxAttempts: number) {
  maybeCleanupExpired();
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
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((WINDOW_MS - elapsedMs) / 1000)
    );
    throw new RateLimitedError(retryAfterSeconds);
  }
}

/** Per-IP counter (login and register both use this, with their own keys). */
export async function checkAndRecordAttempt(key: string, maxAttempts: number) {
  return atomicIncrementAndCheck(key, maxAttempts);
}

/**
 * Records one failed login for `email` (already-normalized) and throws
 * RateLimitedError once LOGIN_ACCOUNT_MAX_FAILURES is exceeded. Call this
 * only after password verification has actually failed - never before,
 * and never for a successful login (see resetLoginFailures instead).
 */
export async function recordLoginFailure(normalizedEmail: string) {
  return atomicIncrementAndCheck(
    `login-fail:${normalizedEmail}`,
    LOGIN_ACCOUNT_MAX_FAILURES
  );
}

/**
 * Clears the failure counter for `email` - call on every successful
 * login so prior mistyped-password attempts (the user's own, or an
 * attacker's) never linger against the account once the real owner
 * proves who they are.
 */
export async function resetLoginFailures(normalizedEmail: string) {
  await prisma.authRateLimit.deleteMany({
    where: { key: `login-fail:${normalizedEmail}` }
  });
}

export function clientIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const first = forwardedFor?.split(",")[0]?.trim();
  return first || request.headers.get("x-real-ip") || "unknown";
}

/**
 * Deletes AuthRateLimit rows whose window closed well in the past, so the
 * table doesn't grow unbounded. Safe to call anytime: a row past its own
 * window is never consulted for an active decision again.
 */
export async function cleanupExpiredRateLimits(retentionMs = WINDOW_MS * 6) {
  const cutoff = new Date(Date.now() - retentionMs);
  const result = await prisma.authRateLimit.deleteMany({
    where: { windowStart: { lt: cutoff } }
  });
  return result.count;
}

// Opportunistic cleanup: a small, random chance on each rate-limited
// request, rather than every request (keeps the hot path from paying for
// it almost always) or requiring separate cron infrastructure to exist
// at all. scripts/cleanup-rate-limits.ts covers the same job for anyone
// who does want to wire up a real scheduler (Vercel Cron, GitHub Actions).
function maybeCleanupExpired() {
  if (Math.random() < 0.01) {
    void cleanupExpiredRateLimits().catch((error) => {
      console.error("AuthRateLimit cleanup failed", error);
    });
  }
}
