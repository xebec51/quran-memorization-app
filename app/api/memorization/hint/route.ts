import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { requestQuestionHint } from "@/lib/memorization/service";
import { jsonOk, routeError } from "@/lib/validation/api";

const hintSchema = z.object({
  questionId: z.string().min(1),
  type: z.enum(["JUZ", "SURAH", "EXTEND_FRAGMENT", "NEXT_VERSE"])
});

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const input = hintSchema.parse(await request.json());
    return jsonOk(await requestQuestionHint(user.id, input.questionId, input.type));
  } catch (error) {
    return routeError(error);
  }
}
