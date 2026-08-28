import { requireUser } from "@/lib/auth/session";
import { getStqhnSummary } from "@/lib/memorization/stqhn/service";
import { withServerTiming } from "@/lib/performance/timing";
import { jsonOk, routeError } from "@/lib/validation/api";

export async function GET() {
  return withServerTiming(async () => {
    try {
      const user = await requireUser();
      return jsonOk(await getStqhnSummary(user.id));
    } catch (error) {
      return routeError(error);
    }
  });
}
