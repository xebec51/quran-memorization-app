import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import {
  getEvaluationHistory,
  getEvaluationSummary
} from "@/lib/memorization/evaluation/service";
import { withServerTiming } from "@/lib/performance/timing";
import { jsonOk, routeError } from "@/lib/validation/api";

const schema = z.object({
  cursor: z.string().min(1).nullable().default(null),
  limit: z.coerce.number().int().min(1).max(50).default(20)
});

export async function GET(request: Request) {
  return withServerTiming(async () => {
    try {
      const user = await requireUser();
      const { searchParams } = new URL(request.url);
      const input = schema.parse({
        cursor: searchParams.get("cursor"),
        limit: searchParams.get("limit") ?? undefined
      });
      const history = await getEvaluationHistory(
        user.id,
        input.cursor,
        input.limit
      );
      // Summary is only meaningful on the first page - it is an
      // aggregate over the whole history, not a per-page value, and the
      // client already holds it after the initial load (updated locally
      // as new attempts are submitted). Recomputing it on every
      // load-more call would be a wasted pair of DB queries.
      if (input.cursor === null) {
        const summary = await getEvaluationSummary(user.id);
        return jsonOk({ ...history, summary });
      }
      return jsonOk(history);
    } catch (error) {
      return routeError(error);
    }
  });
}
