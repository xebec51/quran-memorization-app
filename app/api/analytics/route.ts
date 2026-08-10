import { requireUser } from "@/lib/auth/session";
import { getAnalytics } from "@/lib/memorization/analytics/service";
import { withServerTiming } from "@/lib/performance/timing";
import { jsonOk, routeError } from "@/lib/validation/api";

export async function GET() {
  return withServerTiming(async () => {
    try {
      const user = await requireUser();
      return jsonOk(await getAnalytics(user.id));
    } catch (error) {
      return routeError(error);
    }
  });
}
