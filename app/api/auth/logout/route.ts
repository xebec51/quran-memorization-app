import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth/session";
import { jsonOk, routeError } from "@/lib/validation/api";

export async function POST(request: Request) {
  try {
    await destroySession();
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) return jsonOk({ ok: true });
    return NextResponse.redirect(new URL("/login", request.url), 303);
  } catch (error) {
    return routeError(error);
  }
}
