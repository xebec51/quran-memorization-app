import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { revealNextAyah } from "@/lib/memorization/reveal/service";
import { withServerTiming } from "@/lib/performance/timing";
import { jsonOk, routeError } from "@/lib/validation/api";

const schema = z.object({
  questionId: z.string().min(1),
  expectedRevealedCount: z.number().int().min(0)
});

export async function POST(request: Request) {
  return withServerTiming(async () => {
    try {
      const user = await requireUser();
      const input = schema.parse(await request.json());
      return jsonOk(
        await revealNextAyah(user.id, input.questionId, input.expectedRevealedCount)
      );
    } catch (error) {
      return routeError(error);
    }
  });
}
