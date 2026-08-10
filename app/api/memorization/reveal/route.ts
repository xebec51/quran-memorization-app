import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { revealAnswer } from "@/lib/memorization/service";
import { jsonOk, routeError } from "@/lib/validation/api";

const schema = z.object({ questionId: z.string().min(1) });

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const input = schema.parse(await request.json());
    return jsonOk(await revealAnswer(user.id, input.questionId));
  } catch (error) {
    return routeError(error);
  }
}
