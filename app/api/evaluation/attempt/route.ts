import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { submitEvaluationAttempt } from "@/lib/memorization/evaluation/service";
import { withServerTiming } from "@/lib/performance/timing";
import { jsonOk, routeError } from "@/lib/validation/api";

const schema = z.object({
  questionId: z.string().min(1),
  result: z.enum(["CORRECT", "PARTIAL", "MISSED"]),
  belCount: z.number().int().min(0).max(1000),
  tuntunCount: z.number().int().min(0).max(1000)
});

export async function POST(request: Request) {
  return withServerTiming(async () => {
    try {
      const user = await requireUser();
      const input = schema.parse(await request.json());
      return jsonOk(
        await submitEvaluationAttempt(
          user.id,
          input.questionId,
          input.result,
          input.belCount,
          input.tuntunCount
        )
      );
    } catch (error) {
      return routeError(error);
    }
  });
}
