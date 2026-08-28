import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { getOrCreateStqhnAttempt } from "@/lib/memorization/stqhn/service";
import { withServerTiming } from "@/lib/performance/timing";
import { jsonOk, routeError } from "@/lib/validation/api";

const schema = z.object({
  stqhnQuestionId: z.string().min(1)
});

export async function POST(request: Request) {
  return withServerTiming(async () => {
    try {
      const user = await requireUser();
      const input = schema.parse(await request.json());
      return jsonOk(
        await getOrCreateStqhnAttempt(user.id, input.stqhnQuestionId)
      );
    } catch (error) {
      return routeError(error);
    }
  });
}
