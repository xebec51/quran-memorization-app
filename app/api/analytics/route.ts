import { requireUser } from "@/lib/auth/session";
import { getAnalytics } from "@/lib/memorization/analytics/service";
import { jsonOk, routeError } from "@/lib/validation/api";

export async function GET() {
  try {
    const user = await requireUser();
    return jsonOk(await getAnalytics(user.id));
  } catch (error) {
    return routeError(error);
  }
}
