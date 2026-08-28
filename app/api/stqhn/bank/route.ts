import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import {
  getStqhnBank,
  getStqhnSummary
} from "@/lib/memorization/stqhn/service";
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
      // Summary is only meaningful on the first page - see
      // app/api/evaluation/history/route.ts for the identical rationale.
      // Independent reads with no data dependency, so they run concurrently
      // rather than adding a second round trip's latency to every load.
      if (input.cursor === null) {
        const [bank, summary] = await Promise.all([
          getStqhnBank(user.id, input.cursor, input.limit),
          getStqhnSummary(user.id)
        ]);
        return jsonOk({ ...bank, summary });
      }
      const bank = await getStqhnBank(user.id, input.cursor, input.limit);
      return jsonOk(bank);
    } catch (error) {
      return routeError(error);
    }
  });
}
