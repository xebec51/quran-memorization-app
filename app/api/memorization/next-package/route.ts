import { z } from "zod";
import { getOrAllocateNextPackage } from "@/lib/memorization/service";
import { requireUser } from "@/lib/auth/session";
import { withServerTiming } from "@/lib/performance/timing";
import { jsonOk, routeError } from "@/lib/validation/api";

const schema = z.object({
  scope: z
    .enum(["THIRTY_JUZ", "TWENTY_JUZ", "TEN_JUZ"])
    .optional()
    .default("THIRTY_JUZ")
});

export async function POST(request: Request) {
  return withServerTiming(async () => {
    try {
      const user = await requireUser();
      const input = schema.parse(await request.json());
      return jsonOk(await getOrAllocateNextPackage(user.id, input.scope));
    } catch (error) {
      return routeError(error);
    }
  });
}
