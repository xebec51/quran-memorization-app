import { requireUser } from "@/lib/auth/session";
import { getEvaluationBank } from "@/lib/memorization/evaluation/service";
import { withServerTiming } from "@/lib/performance/timing";
import { jsonOk, routeError } from "@/lib/validation/api";

export async function GET() {
  return withServerTiming(async () => {
    try {
      const user = await requireUser();
      return jsonOk(await getEvaluationBank(user.id));
    } catch (error) {
      return routeError(error);
    }
  });
}
