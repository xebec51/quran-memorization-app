import { getOrAllocateNextPackage } from "@/lib/memorization/service";
import { requireUser } from "@/lib/auth/session";
import { jsonOk, routeError } from "@/lib/validation/api";

export async function POST() {
  try {
    const user = await requireUser();
    return jsonOk(await getOrAllocateNextPackage(user.id));
  } catch (error) {
    return routeError(error);
  }
}

export async function GET() {
  return POST();
}
