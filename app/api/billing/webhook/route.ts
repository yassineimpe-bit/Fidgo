import { applyStripeEvent, billingEnabled, constructWebhookEvent } from "@/lib/billing";

export async function POST(request: Request) {
  if (!billingEnabled()) return Response.json({ error: "BILLING_DISABLED" }, { status: 503 });

  const signature = request.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "MISSING_SIGNATURE" }, { status: 400 });

  const payload = await request.text();
  let event;
  try {
    event = constructWebhookEvent(payload, signature);
  } catch (error) {
    console.error("STRIPE_WEBHOOK_SIGNATURE_INVALID", error);
    return Response.json({ error: "INVALID_SIGNATURE" }, { status: 400 });
  }

  try {
    await applyStripeEvent(event);
  } catch (error) {
    console.error("STRIPE_WEBHOOK_HANDLER_FAILED", event.type, error);
    return Response.json({ error: "WEBHOOK_HANDLER_FAILED" }, { status: 500 });
  }

  return Response.json({ received: true });
}
