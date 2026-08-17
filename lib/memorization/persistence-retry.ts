import "server-only";
import { Prisma } from "@/generated/prisma/client";

/**
 * Retries `fn` on a transient persistence conflict - a serialization
 * failure (P2034 / Postgres 40001), a unique-constraint race (P2002), or
 * an interactive-transaction error (P2028, "transaction already closed" -
 * also raised on transaction timeout) - with linear backoff. Any other
 * error (including DomainError) is not retryable and is rethrown on the
 * first attempt.
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
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return ["P2002", "P2028", "P2034"].includes(error.code);
  }
  if (error && typeof error === "object") {
    const maybe = error as { cause?: { originalCode?: string }; name?: string };
    return (
      maybe.cause?.originalCode === "40001" || maybe.name === "DriverAdapterError"
    );
  }
  return false;
}
