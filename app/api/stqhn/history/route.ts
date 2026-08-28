import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { getStqhnHistory } from "@/lib/memorization/stqhn/service";
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
      return jsonOk(await getStqhnHistory(user.id, input.cursor, input.limit));
    } catch (error) {
      return routeError(error);
    }
  });
}
