import { createHmac } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import postgres from "postgres";
import { randomizeClientIp, unique } from "./helpers";

const webhookSecret = "whsec_retiko_e2e";

async function signup(page: Page, label: string) {
  const marker = unique(label);
  const email = `${marker}@example.com`;
  await randomizeClientIp(page);
  await page.goto("/signup");
  await page.getByLabel("Nom du commerce").fill(`Commerce ${marker}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill("Password-test-123!");
  await page.getByRole("button", { name: "Créer mon espace" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  return email;
}

function subscriptionEvent(input: {
  id: string;
  created: number;
  status: string;
  establishmentId: string;
  subscriptionId: string;
  customerId: string;
  priceId: string;
}) {
  return {
    id: input.id,
    object: "event",
    type: "customer.subscription.updated",
    created: input.created,
    data: {
      object: {
        id: input.subscriptionId,
        object: "subscription",
        customer: input.customerId,
        status: input.status,
        metadata: { establishmentId: input.establishmentId },
        cancel_at_period_end: input.status === "canceled",
        trial_end: null,
        items: {
          object: "list",
          data: [{
            id: `si_${input.id}`,
            object: "subscription_item",
            current_period_end: Math.floor(Date.now() / 1000) + 30 * 86_400,
            price: { id: input.priceId, object: "price" },
          }],
        },
      },
    },
  };
}

function checkoutEvent(input: {
  id: string;
  establishmentId: string;
  checkoutSessionId: string;
  subscriptionId: string;
  customerId: string;
  plan: string;
}) {
  return {
    id: input.id,
    object: "event",
    type: "checkout.session.completed",
    created: 900,
    data: {
      object: {
        id: input.checkoutSessionId,
        object: "checkout.session",
        client_reference_id: input.establishmentId,
        customer: input.customerId,
        subscription: input.subscriptionId,
        metadata: { establishmentId: input.establishmentId, retikoPlan: input.plan },
      },
    },
  };
}

async function sendWebhook(request: APIRequestContext, event: object) {
  const payload = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = createHmac("sha256", webhookSecret).update(`${timestamp}.${payload}`).digest("hex");
  return request.post("/api/billing/webhook", {
    headers: {
      "content-type": "application/json",
      "stripe-signature": `t=${timestamp},v1=${digest}`,
    },
    data: payload,
  });
}

test("Stripe v2 : pilote non bloquant, webhook idempotent, ordonné et isolé par tenant", async ({ page, request, browser }) => {
  test.setTimeout(90_000);
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  const tenantBContext = await browser.newContext();
  try {
    const ownerA = await signup(page, "billing-a");
    const [tenantA] = await sql`
      select e.id
      from establishments e join staff_users s on s.establishment_id=e.id
      where s.email=${ownerA}
    `;
    const [initial] = await sql`select plan,status,trial_ends_at,external_subscription_id from subscriptions where establishment_id=${tenantA.id}`;
    expect(initial).toMatchObject({ plan: "PILOT", status: "trial", external_subscription_id: null });
    expect(initial.trial_ends_at).toBeTruthy();

    // Stripe est activé avec des fixtures locales, mais le signup et le
    // dashboard métier n'ont effectué aucun appel financier externe.
    await page.goto("/dashboard/billing");
    await expect(page.getByText("24,99 € HT/mois")).toBeVisible();
    await expect(page.getByText("19,99 € HT/mois")).toBeVisible();
    await expect(page.getByText("210 € HT/an")).toBeVisible();
    expect((await page.request.get("/api/dashboard")).status()).toBe(200);

    const tenantBPage = await tenantBContext.newPage();
    const ownerB = await signup(tenantBPage, "billing-b");
    const [tenantB] = await sql`
      select e.id
      from establishments e join staff_users s on s.establishment_id=e.id
      where s.email=${ownerB}
    `;

    const base = {
      establishmentId: String(tenantA.id),
      subscriptionId: "sub_e2e_tenant_a",
      customerId: "cus_e2e_tenant_a",
    };
    await sql`
      update subscriptions
      set stripe_checkout_session_id='cs_e2e_tenant_a',
          stripe_checkout_plan='FLEX',
          stripe_checkout_pending_at=now(),
          stripe_checkout_claim_token='claim_e2e_tenant_a'
      where establishment_id=${tenantA.id}
    `;
    const spoofedCheckout = await sendWebhook(request, checkoutEvent({
      ...base,
      id: "evt_e2e_checkout_spoofed",
      checkoutSessionId: "cs_e2e_tenant_a",
      establishmentId: String(tenantB.id),
      plan: "FLEX",
    }));
    expect(spoofedCheckout.status()).toBe(500);
    const checkout = await sendWebhook(request, checkoutEvent({
      ...base,
      id: "evt_e2e_checkout",
      checkoutSessionId: "cs_e2e_tenant_a",
      plan: "FLEX",
    }));
    expect(checkout.status()).toBe(200);
    await expect(checkout.json()).resolves.toMatchObject({ result: "applied" });

    const active = subscriptionEvent({ ...base, id: "evt_e2e_active", created: 1_000, status: "active", priceId: "price_e2e_flex" });
    const invalidSignature = await request.post("/api/billing/webhook", {
      headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=invalid" },
      data: JSON.stringify(active),
    });
    expect(invalidSignature.status()).toBe(400);
    const [{ count: invalidStored }] = await sql`select count(*)::int as count from stripe_webhook_events where event_id='evt_e2e_active'`;
    expect(Number(invalidStored)).toBe(0);

    const first = await sendWebhook(request, active);
    expect(first.status()).toBe(200);
    await expect(first.json()).resolves.toMatchObject({ result: "applied" });
    const replay = await sendWebhook(request, active);
    await expect(replay.json()).resolves.toMatchObject({ result: "duplicate" });

    for (const change of [
      { id: "evt_e2e_past_due", created: 1_100, status: "past_due", priceId: "price_e2e_flex" },
      { id: "evt_e2e_canceled", created: 1_200, status: "canceled", priceId: "price_e2e_flex" },
      { id: "evt_e2e_annual", created: 1_300, status: "active", priceId: "price_e2e_annual" },
      { id: "evt_e2e_unpaid", created: 1_400, status: "unpaid", priceId: "price_e2e_annual" },
    ]) {
      const response = await sendWebhook(request, subscriptionEvent({ ...base, ...change }));
      expect(response.status()).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ result: "applied" });
    }

    const stale = await sendWebhook(request, subscriptionEvent({
      ...base,
      id: "evt_e2e_stale",
      created: 1_250,
      status: "active",
      priceId: "price_e2e_flex",
    }));
    await expect(stale.json()).resolves.toMatchObject({ result: "ignored" });

    const [stateA] = await sql`select plan,billing_interval,status,external_customer_id,external_subscription_id from subscriptions where establishment_id=${tenantA.id}`;
    expect(stateA).toMatchObject({
      plan: "ANNUAL",
      billing_interval: "annual",
      status: "unpaid",
      external_customer_id: "cus_e2e_tenant_a",
      external_subscription_id: "sub_e2e_tenant_a",
    });
    const [{ count: processed }] = await sql`select count(*)::int as count from stripe_webhook_events where event_id='evt_e2e_active'`;
    expect(Number(processed)).toBe(1);

    const crossTenant = await sendWebhook(request, subscriptionEvent({
      ...base,
      id: "evt_e2e_cross_tenant",
      created: 1_500,
      status: "active",
      establishmentId: String(tenantB.id),
      priceId: "price_e2e_flex",
    }));
    expect(crossTenant.status()).toBe(500);
    const [stateB] = await sql`select external_customer_id,external_subscription_id,status from subscriptions where establishment_id=${tenantB.id}`;
    expect(stateB).toMatchObject({ external_customer_id: null, external_subscription_id: null, status: "trial" });
    const [{ count: rejected }] = await sql`select count(*)::int as count from stripe_webhook_events where event_id='evt_e2e_cross_tenant'`;
    expect(Number(rejected)).toBe(0);

    const metadataOnly = await sendWebhook(request, subscriptionEvent({
      establishmentId: String(tenantB.id),
      subscriptionId: "sub_e2e_unbound",
      customerId: "cus_e2e_unbound",
      id: "evt_e2e_metadata_only",
      created: 1_600,
      status: "active",
      priceId: "price_e2e_flex",
    }));
    expect(metadataOnly.status()).toBe(500);
    const [stillIsolated] = await sql`select external_customer_id,external_subscription_id,status from subscriptions where establishment_id=${tenantB.id}`;
    expect(stillIsolated).toMatchObject({ external_customer_id: null, external_subscription_id: null, status: "trial" });
  } finally {
    await tenantBContext.close();
    await sql.end({ timeout: 5 });
  }
});
