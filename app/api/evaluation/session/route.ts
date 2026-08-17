import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { getOrCreateEvaluationSession } from "@/lib/memorization/evaluation/service";
import { withServerTiming } from "@/lib/performance/timing";
import { jsonOk, routeError } from "@/lib/validation/api";

const schema = z.object({
  questionId: z.string().min(1)
});

export async function POST(request: Request) {
  return withServerTiming(async () => {
    try {
      const user = await requireUser();
      const input = schema.parse(await request.json());
      return jsonOk(
        await getOrCreateEvaluationSession(user.id, input.questionId)
      );
    } catch (error) {
      return routeError(error);
    }
  });
}
