type ApiOptions = {
  method?: "GET" | "POST";
  keepalive?: boolean;
  /** Milliseconds before the request is aborted. Default 15s. */
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Shared fetch + {data, error} envelope unwrap for this app's JSON API
 * routes. Throws with the server's message on failure so callers can
 * catch-and-display it directly.
 *
 * Aborts via AbortController after timeoutMs so a stalled connection
 * (dropped wifi, a hung server) surfaces as a clear, bounded error
 * instead of leaving pendingAction/loading state stuck forever with no
 * feedback. `keepalive` requests (fire-and-forget submissions that must
 * survive page unload) skip the timeout - the browser owns their
 * lifetime once the page navigates away, and combining keepalive with an
 * abort defeats the point of using keepalive at all.
 */
export async function apiFetch<T>(
  url: string,
  body?: unknown,
  options: ApiOptions = {}
): Promise<T> {
  const method = options.method ?? "POST";
  const controller = options.keepalive ? null : new AbortController();
  const timeoutId = controller
    ? setTimeout(
        () => controller.abort(),
        options.timeoutMs ?? DEFAULT_TIMEOUT_MS
      )
    : null;
  try {
    const response = await fetch(url, {
      method,
      ...(method === "POST"
        ? {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body ?? {})
          }
        : {}),
      keepalive: options.keepalive,
      signal: controller?.signal
    });
    const json = (await response.json()) as {
      data?: T;
      error?: { message: string };
    };
    if (!response.ok || !json.data)
      throw new Error(json.error?.message ?? "Permintaan gagal.");
    return json.data;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Permintaan melebihi batas waktu. Coba lagi.");
    }
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
