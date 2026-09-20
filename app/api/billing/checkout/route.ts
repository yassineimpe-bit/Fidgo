import { getSession } from "@/lib/auth";
import {
  BillingInputError,
  billingEnabled,
  checkoutPlanFromRequest,
  createCheckoutSession,
  expireCheckoutSession,
  getBillingRuntimeStatus,
} from "@/lib/billing";
import { sql } from "@/lib/db";
import { canManageBilling, isValidIdempotencyKey } from "@/lib/loyalty";
import { safeErrorCode, withApiErrorHandling } from "@/lib/observability";
import { rateLimit } from "@/lib/rate-limit";
import { rejectCrossOrigin } from "@/lib/security";

async function handlePost(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const session = await getSession();
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!canManageBilling(session.role)) return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  if (!billingEnabled()) return Response.json({ error: "BILLING_DISABLED" }, { status: 503 });
  if (!getBillingRuntimeStatus().configured) {
    return Response.json({ error: "BILLING_NOT_CONFIGURED" }, { status: 503 });
  }

  const limited = await rateLimit(request, "billing-checkout", 10, 60 * 60);
  if (!limited.allowed) return Response.json({ error: "TOO_MANY_ATTEMPTS" }, { status: 429 });

  const body = await request.json().catch(() => ({}));
  let plan;
  try {
    plan = checkoutPlanFromRequest(body);
  } catch (error) {
    if (error instanceof BillingInputError) {
      return Response.json({ error: error.code }, { status: 400 });
    }
    throw error;
  }

  const requestedKey = request.headers.get("idempotency-key");
  if (requestedKey && !isValidIdempotencyKey(requestedKey)) {
    return Response.json({ error: "INVALID_IDEMPOTENCY_KEY" }, { status: 400 });
  }
  const idempotencyKey = `retiko-checkout:${session.establishmentId}:${plan}:${requestedKey || crypto.randomUUID()}`;

  const claimToken = crypto.randomUUID();
  const [subscription] = await sql`
    update subscriptions
    set stripe_checkout_claim_token = ${claimToken},
        stripe_checkout_plan = ${plan},
        stripe_checkout_pending_at = now(),
        stripe_checkout_session_id = null,
        updated_at = now()
    where establishment_id = ${session.establishmentId}
      and (external_subscription_id is null or status = 'canceled')
      and (stripe_checkout_pending_at is null or stripe_checkout_pending_at < now() - interval '35 minutes')
    returning status, trial_ends_at, external_customer_id, external_subscription_id
  `;
  if (!subscription) {
    const [current] = await sql`
      select external_subscription_id, status, stripe_checkout_pending_at
      from subscriptions
      where establishment_id = ${session.establishmentId}
      limit 1
    `;
    if (!current) return Response.json({ error: "BILLING_STATE_NOT_FOUND" }, { status: 409 });
    if (current.external_subscription_id && String(current.status) !== "canceled") {
      return Response.json({ error: "ALREADY_SUBSCRIBED" }, { status: 409 });
    }
    return Response.json({ error: "CHECKOUT_PENDING" }, { status: 409 });
  }

  let checkoutId: string | null = null;
  try {
    const checkout = await createCheckoutSession({
      establishmentId: session.establishmentId,
      email: session.email,
      plan,
      trialEndsAt: subscription.trial_ends_at as Date | string | null,
      customerId: subscription.external_customer_id ? String(subscription.external_customer_id) : null,
      idempotencyKey,
    });
    if (!checkout.url) throw new Error("STRIPE_CHECKOUT_URL_MISSING");
    checkoutId = checkout.id;
    const persisted = await sql`
      update subscriptions
      set stripe_checkout_session_id = ${checkout.id}, updated_at = now()
      where establishment_id = ${session.establishmentId}
        and stripe_checkout_claim_token = ${claimToken}
      returning id
    `;
    if (persisted.length !== 1) {
      await expireCheckoutSession(checkout.id).catch(() => undefined);
      throw new Error("STRIPE_CHECKOUT_CLAIM_LOST");
    }
    return Response.json({ url: checkout.url }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    await sql`
      update subscriptions
      set stripe_checkout_claim_token = null,
          stripe_checkout_plan = null,
          stripe_checkout_pending_at = null,
          stripe_checkout_session_id = case when stripe_checkout_session_id = ${checkoutId} then null else stripe_checkout_session_id end,
          updated_at = now()
      where establishment_id = ${session.establishmentId}
        and stripe_checkout_claim_token = ${claimToken}
    `;
    console.error("STRIPE_CHECKOUT_CREATE_FAILED", { code: safeErrorCode(error, "STRIPE_CHECKOUT_CREATE_FAILED") });
    return Response.json({ error: "STRIPE_UNAVAILABLE" }, { status: 502 });
  }
}

export const POST = withApiErrorHandling("BILLING_CHECKOUT", handlePost);
