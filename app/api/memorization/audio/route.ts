import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { getPromptAudioClip } from "@/lib/memorization/audio/service";
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
      const clip = await getPromptAudioClip(user.id, input.questionId);
      return jsonOk({
        questionId: clip.questionId,
        reciterName: clip.reciterName,
        audioUrl: `/api/memorization/audio-file?questionId=${encodeURIComponent(
          clip.questionId
        )}`,
        startMs: clip.startMs,
        endMs: clip.endMs,
        format: clip.format
      });
    } catch (error) {
      return routeError(error);
    }
  });
}
