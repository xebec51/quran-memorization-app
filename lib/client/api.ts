type ApiOptions = {
  method?: "GET" | "POST";
  keepalive?: boolean;
};

/**
 * Shared fetch + {data, error} envelope unwrap for this app's JSON API
 * routes. Throws with the server's message on failure so callers can
 * catch-and-display it directly.
 */
export async function apiFetch<T>(
  url: string,
  body?: unknown,
  options: ApiOptions = {}
): Promise<T> {
  const method = options.method ?? "POST";
  const response = await fetch(url, {
    method,
    ...(method === "POST"
      ? {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body ?? {})
        }
      : {}),
    keepalive: options.keepalive
  });
  const json = (await response.json()) as {
    data?: T;
    error?: { message: string };
  };
  if (!response.ok || !json.data)
    throw new Error(json.error?.message ?? "Permintaan gagal.");
  return json.data;
}
