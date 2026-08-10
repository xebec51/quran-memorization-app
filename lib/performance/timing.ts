import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

type TimingEntry = {
  name: string;
  durationMs: number;
};

const timingStore = new AsyncLocalStorage<TimingEntry[]>();

export async function measureServerTiming<T>(
  name: string,
  fn: () => Promise<T>
): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    const entries = timingStore.getStore();
    if (entries) {
      entries.push({
        name: sanitizeTimingName(name),
        durationMs: performance.now() - start
      });
    }
  }
}

export async function withServerTiming(handler: () => Promise<Response>) {
  const entries: TimingEntry[] = [];
  return timingStore.run(entries, async () => {
    const response = await handler();
    const headerValue = serverTimingHeader(entries);
    if (headerValue) response.headers.set("Server-Timing", headerValue);
    return response;
  });
}

function serverTimingHeader(entries: readonly TimingEntry[]) {
  return entries
    .map(
      (entry) => `${entry.name};dur=${Math.max(0, entry.durationMs).toFixed(1)}`
    )
    .join(", ");
}

function sanitizeTimingName(name: string) {
  return name.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 48) || "timing";
}
