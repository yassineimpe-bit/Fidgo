import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { purgeStaleRateLimits } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;

  // The cron can safely be deployed before CRON_SECRET is configured. In that
  // state it is intentionally a no-op so production does not emit a daily 5xx.
  if (!secret || secret.length < 32) {
    return new Response(null, {
      status: 204,
      headers: { "cache-control": "no-store", "x-fidgo-cron": "disabled" },
    });
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
