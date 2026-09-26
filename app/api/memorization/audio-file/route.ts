import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { getPromptAudioClip } from "@/lib/memorization/audio/service";
import { routeError } from "@/lib/validation/api";

const schema = z.object({
  questionId: z.string().min(1)
});

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const input = schema.parse({
      questionId: url.searchParams.get("questionId")
    });
    const clip = await getPromptAudioClip(user.id, input.questionId);
    const upstream = await fetch(clip.audioUrl, {
      headers: { accept: "audio/mpeg,audio/*;q=0.9,*/*;q=0.1" }
    });
    if (!upstream.ok || !upstream.body) {
      throw new Error("Audio syeikh gagal dimuat.");
    }
    return new Response(upstream.body, {
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "audio/mpeg",
        "cache-control": "private, no-store"
      }
    });
  } catch (error) {
    return routeError(error);
  }
}
