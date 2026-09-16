import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { billingEnabled, createBillingPortalSession } from "@/lib/billing";
import { canManageProgram } from "@/lib/loyalty";
import { rateLimit } from "@/lib/rate-limit";
import { rejectCrossOrigin } from "@/lib/security";

export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const session = await getSession();
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!canManageProgram(session.role)) return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  if (!billingEnabled()) return Response.json({ error: "BILLING_DISABLED" }, { status: 503 });

  const limited = await rateLimit(request, "billing-portal", 10, 60 * 60);
  if (!limited.allowed) return Response.json({ error: "TOO_MANY_ATTEMPTS" }, { status: 429 });

  const [subscription] = await sql`select external_customer_id from subscriptions where establishment_id = ${session.establishmentId} limit 1`;
  if (!subscription?.external_customer_id) return Response.json({ error: "NO_STRIPE_CUSTOMER" }, { status: 409 });

  try {
    const portalSession = await createBillingPortalSession(String(subscription.external_customer_id));
    return Response.json({ url: portalSession.url });
  } catch (error) {
    console.error("STRIPE_PORTAL_CREATE_FAILED", error);
    return Response.json({ error: "STRIPE_ERROR" }, { status: 502 });
  }
}
