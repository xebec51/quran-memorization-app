import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { submitAssessment } from "@/lib/memorization/service";
import { jsonOk, routeError } from "@/lib/validation/api";

const schema = z.object({
  questionId: z.string().min(1),
  assessment: z.enum(["CORRECT", "PARTIAL", "MISSED"])
});

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const input = schema.parse(await request.json());
    return jsonOk(await submitAssessment(user.id, input.questionId, input.assessment));
  } catch (error) {
    return routeError(error);
  }
}
