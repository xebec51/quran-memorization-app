/**
 * Runs once when the server process starts (both `next dev` and
 * production/Vercel) - see https://nextjs.org/docs/app/guides/instrumentation.
 * Before this file existed, lib/server-env.ts's getServerEnv() was fully
 * written but never called anywhere in the app runtime, so a missing or
 * malformed required env var (e.g. AUTH_SECRET under 32 chars) would only
 * surface later as a confusing failure the first time some unrelated
 * request happened to touch it, rather than as a clear error at boot.
 *
 * Dynamically imported so the "server-only"-guarded module (and its Zod
 * validation) is never evaluated in the edge runtime, where this register()
 * function also runs but process.env shape/availability differs.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getServerEnv } = await import("./lib/server-env");
    getServerEnv();
  }
}
