import "server-only";
import { Prisma } from "@/generated/prisma/client";

/**
 * Retries `fn` on a *verified* transient persistence conflict - Prisma's
 * own dedicated write-conflict code (P2034), or the raw Postgres
 * serialization_failure (40001) / deadlock_detected (40P01) SQLSTATEs,
 * wherever they surface (a PrismaClientKnownRequestError, a wrapped
 * DriverAdapterError, or anything else) - with linear backoff. Any other
 * error (including DomainError, P2002, or any P2028 not itself carrying
 * one of these two SQLSTATEs) is not retryable and is rethrown on the
 * first attempt.
 *
 * Previously this retried on P2002 unconditionally and on *any*
 * DriverAdapterError by name alone, regardless of cause. Both are wrong:
 * P2002 races that genuinely need a retry-and-recheck are already handled
 * explicitly by their own callers (see submitEvaluationAttempt's P2002
 * catch), so retrying it here a second time only delays a genuine
 * duplicate-data bug from surfacing. A blanket DriverAdapterError retry is
 * worse - @prisma/adapter-pg wraps EVERY underlying `pg` failure in that
 * same error name (a real bug, a bad query, a connection drop, anything),
 * so treating the name alone as retryable silently retried non-transient
 * failures up to 8 times at 15s per transaction attempt, which is exactly
 * what turned a single fast, clear error into e2e tests hanging for
 * minutes with no diagnostic signal.
 */
export async function retrySerialization<T>(
  fn: () => Promise<T>,
  attempts = 8
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryablePersistenceConflict(error)) break;
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
  throw lastError;
}

export function isRetryablePersistenceConflict(error: unknown) {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  ) {
    return true;
  }
  const originalCode = extractPostgresErrorCode(error);
  return originalCode === "40001" || originalCode === "40P01";
}

/**
 * Postgres's SQLSTATE for the failure, regardless of which wrapper it
 * arrives in - @prisma/adapter-pg's DriverAdapterError exposes it at
 * `error.cause.originalCode` (or `error.cause.code`, depending on where
 * in the adapter the failure originated); a PrismaClientKnownRequestError
 * for a raw-SQL failure (P2010) carries it at `error.meta.code`.
 */
function extractPostgresErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const maybe = error as {
    cause?: { originalCode?: string; code?: string };
    meta?: { code?: string };
  };
  return maybe.cause?.originalCode ?? maybe.cause?.code ?? maybe.meta?.code;
}
