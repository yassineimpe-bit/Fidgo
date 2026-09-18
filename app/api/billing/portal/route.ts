import { getSession } from "@/lib/auth";
import {
  billingEnabled,
  createBillingPortalSession,
  getBillingRuntimeStatus,
} from "@/lib/billing";
import { sql } from "@/lib/db";
import { safeErrorCode, withApiErrorHandling } from "@/lib/observability";
import { rateLimit } from "@/lib/rate-limit";
import { rejectCrossOrigin } from "@/lib/security";

async function handlePost(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const session = await getSession();
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (session.role !== "OWNER") return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  if (!billingEnabled()) return Response.json({ error: "BILLING_DISABLED" }, { status: 503 });
  if (!getBillingRuntimeStatus().configured) {
    return Response.json({ error: "BILLING_NOT_CONFIGURED" }, { status: 503 });
  }

  const limited = await rateLimit(request, "billing-portal", 10, 60 * 60);
  if (!limited.allowed) return Response.json({ error: "TOO_MANY_ATTEMPTS" }, { status: 429 });

  const [subscription] = await sql`
    select external_customer_id
    from subscriptions
    where establishment_id = ${session.establishmentId}
    limit 1
  `;
  if (!subscription?.external_customer_id) {
    return Response.json({ error: "NO_STRIPE_CUSTOMER" }, { status: 409 });
  }

  try {
    const portal = await createBillingPortalSession(String(subscription.external_customer_id));
    if (!portal.url) return Response.json({ error: "STRIPE_PORTAL_URL_MISSING" }, { status: 502 });
    return Response.json({ url: portal.url }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("STRIPE_PORTAL_CREATE_FAILED", { code: safeErrorCode(error, "STRIPE_PORTAL_CREATE_FAILED") });
    return Response.json({ error: "STRIPE_UNAVAILABLE" }, { status: 502 });
  }
}

export const POST = withApiErrorHandling("BILLING_PORTAL", handlePost);
