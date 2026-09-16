import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { billingEnabled, createCheckoutSession, isBillingInterval } from "@/lib/billing";
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

  const limited = await rateLimit(request, "billing-checkout", 10, 60 * 60);
  if (!limited.allowed) return Response.json({ error: "TOO_MANY_ATTEMPTS" }, { status: 429 });

  const body = await request.json().catch(() => ({}));
  const interval = isBillingInterval(body.billingInterval) ? body.billingInterval : "monthly";

  const [subscription] = await sql`
    select status, trial_ends_at, external_customer_id, external_subscription_id
    from subscriptions
    where establishment_id = ${session.establishmentId}
    limit 1
  `;
  if (!subscription) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  if (subscription.external_subscription_id && String(subscription.status) !== "cancelled") {
    return Response.json({ error: "ALREADY_SUBSCRIBED" }, { status: 409 });
  }

  try {
    const checkoutSession = await createCheckoutSession({
      establishmentId: session.establishmentId,
      email: session.email,
      interval,
      trialEndsAt: subscription.trial_ends_at as Date | string | null,
      customerId: subscription.external_customer_id ? String(subscription.external_customer_id) : null,
    });
    return Response.json({ url: checkoutSession.url });
  } catch (error) {
    console.error("STRIPE_CHECKOUT_CREATE_FAILED", error);
    return Response.json({ error: "STRIPE_ERROR" }, { status: 502 });
  }
}
