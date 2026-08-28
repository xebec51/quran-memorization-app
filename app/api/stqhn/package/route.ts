import { getOrAllocateStqhnPackage } from "@/lib/memorization/stqhn/service";
import { requireUser } from "@/lib/auth/session";
import { withServerTiming } from "@/lib/performance/timing";
import { jsonOk, routeError } from "@/lib/validation/api";

export async function POST() {
  return withServerTiming(async () => {
    try {
      const user = await requireUser();
      return jsonOk(await getOrAllocateStqhnPackage(user.id));
    } catch (error) {
      return routeError(error);
    }
  });
}
