import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { purgeStaleRateLimits } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32) {
    return Response.json(
      { error: "CRON_NOT_CONFIGURED" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  if (!isAuthorizedCronRequest(request.headers.get("authorization"), secret)) {
    return Response.json(
      { error: "UNAUTHORIZED" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  const purged = await purgeStaleRateLimits(24);
  return Response.json(
    { ok: true, purged },
    { headers: { "cache-control": "no-store" } },
  );
}
