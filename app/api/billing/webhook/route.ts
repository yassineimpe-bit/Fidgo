import {
  applyStripeEvent,
  billingEnabled,
  constructWebhookEvent,
  getBillingRuntimeStatus,
} from "@/lib/billing";
import { safeErrorCode, withApiErrorHandling } from "@/lib/observability";

async function handlePost(request: Request) {
  if (!billingEnabled()) return Response.json({ error: "BILLING_DISABLED" }, { status: 503 });
  if (!getBillingRuntimeStatus().configured) {
    return Response.json({ error: "BILLING_NOT_CONFIGURED" }, { status: 503 });
  }
  const signature = request.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "MISSING_SIGNATURE" }, { status: 400 });

  const payload = await request.text();
  let event;
  try {
    event = constructWebhookEvent(payload, signature);
  } catch {
    return Response.json({ error: "INVALID_SIGNATURE" }, { status: 400 });
  }

  try {
    const result = await applyStripeEvent(event);
    return Response.json({ received: true, result });
  } catch (error) {
    console.error("STRIPE_WEBHOOK_HANDLER_FAILED", {
      code: safeErrorCode(error, "STRIPE_WEBHOOK_HANDLER_FAILED"),
      eventType: event.type,
    });
    return Response.json({ error: "WEBHOOK_HANDLER_FAILED" }, { status: 500 });
  }
}

export const POST = withApiErrorHandling("BILLING_WEBHOOK", handlePost);
