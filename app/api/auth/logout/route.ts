import { destroySession } from "@/lib/auth/session";
import { jsonOk, routeError } from "@/lib/validation/api";

export async function POST() {
  try {
    await destroySession();
    return jsonOk({ ok: true });
  } catch (error) {
    return routeError(error);
  }
}
