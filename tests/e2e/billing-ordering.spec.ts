import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import type Stripe from "stripe";
import postgres from "postgres";
import { applyStripeEvent } from "../../lib/billing";

// Vraie transaction PostgreSQL ; seul le GET fournisseur est simulé.
// Aucun test ne peut atteindre une base distante par accident.
const url = new URL(process.env.DATABASE_URL || "postgres://localhost/unconfigured");
if (!["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error("LOCAL_TEST_DATABASE_REQUIRED");
const sql = postgres(url.toString(), { max: 2, prepare: false });
process.env.STRIPE_PRICE_FLEX_MONTHLY = "price_ordering_flex";

function subscription(id: string, customer: string, tenant: string, status = "canceled") {
  return {
    id, customer, status, metadata: { establishmentId: tenant },
    cancel_at_period_end: status === "canceled", trial_end: null,
    items: { data: [{ price: { id: "price_ordering_flex" }, current_period_end: 2_000_000_000 }] },
  } as unknown as Stripe.Subscription;
}
function event(id: string, object: Stripe.Subscription, created = 1000) {
  return { id, type: "customer.subscription.updated", created, data: { object } } as Stripe.Event;
}

test("same-second subscriptions converge in both delivery orders, without lexical event ordering", async () => {
  for (const reverse of [false, true]) {
    const tenant = randomUUID();
    const sub = `sub_${tenant}`; const customer = `cus_${tenant}`;
    await sql`insert into establishments(id,name,slug) values(${tenant},'Ordering test',${tenant})`;
    await sql`insert into subscriptions(establishment_id,provider,external_customer_id,external_subscription_id,plan,status)
      values(${tenant},'stripe',${customer},${sub},'FLEX','trial')`;
    const latest = subscription(sub, customer, tenant);
    const old = event(`evt_z_${tenant}`, subscription(sub, customer, tenant, "active"));
    const current = event(`evt_a_${tenant}`, latest);
    const events = reverse ? [current, old] : [old, current];
    const reader = { subscriptions: { retrieve: async () => latest } };
    for (const e of events) await applyStripeEvent(e, reader as unknown as Pick<Stripe, "subscriptions">);
    const [row] = await sql`select status,cancel_at_period_end from subscriptions where establishment_id=${tenant}`;
    expect(row).toMatchObject({ status: "canceled", cancel_at_period_end: true });
    expect(await applyStripeEvent(events[1], reader as unknown as Pick<Stripe, "subscriptions">)).toBe("duplicate");
    expect(await applyStripeEvent(event(`evt_older_${tenant}`, old.data.object as Stripe.Subscription, 999), reader as unknown as Pick<Stripe, "subscriptions">)).toBe("ignored");
  }
});

test("ambiguous reconciliation retries after provider failure and rejects foreign data", async () => {
  const tenant = randomUUID();
  const sub = `sub_${tenant}`; const customer = `cus_${tenant}`;
  await sql`insert into establishments(id,name,slug) values(${tenant},'Retry test',${tenant})`;
  await sql`insert into subscriptions(establishment_id,provider,external_customer_id,external_subscription_id,plan,status)
    values(${tenant},'stripe',${customer},${sub},'FLEX','trial')`;
  await applyStripeEvent(event(`evt_first_${tenant}`, subscription(sub, customer, tenant, "active")));
  const next = event(`evt_next_${tenant}`, subscription(sub, customer, tenant));
  const reader = (retrieve: () => Promise<Stripe.Subscription>) => ({ subscriptions: { retrieve } }) as unknown as Pick<Stripe, "subscriptions">;
  await expect(applyStripeEvent(next, reader(async () => { throw new Error("PROVIDER_UNAVAILABLE"); }))).rejects.toThrow("PROVIDER_UNAVAILABLE");
  for (const foreign of [subscription(sub, "cus_other", tenant), subscription("sub_other", customer, tenant), subscription(sub, customer, randomUUID())]) {
    await expect(applyStripeEvent(next, reader(async () => foreign))).rejects.toThrow("STRIPE_TENANT_MISMATCH");
  }
  const unknownPrice = subscription(sub, customer, tenant);
  unknownPrice.items.data[0].price.id = "price_unknown";
  await expect(applyStripeEvent(next, reader(async () => unknownPrice))).rejects.toThrow("STRIPE_PRICE_OR_CUSTOMER_UNKNOWN");
  const [receipt] = await sql`select count(*)::int as count from stripe_webhook_events where event_id=${next.id}`;
  expect(receipt.count).toBe(0);
  const [unchanged] = await sql`select status from subscriptions where establishment_id=${tenant}`;
  expect(unchanged.status).toBe("active");
  expect(await applyStripeEvent(next, reader(async () => subscription(sub, customer, tenant)))).toBe("applied");
});

test("concurrent same-second deliveries converge under the subscription row lock", async () => {
  const tenant = randomUUID(); const sub = `sub_${tenant}`; const customer = `cus_${tenant}`;
  await sql`insert into establishments(id,name,slug) values(${tenant},'Concurrent test',${tenant})`;
  await sql`insert into subscriptions(establishment_id,provider,external_customer_id,external_subscription_id,plan,status)
    values(${tenant},'stripe',${customer},${sub},'FLEX','trial')`;
  const latest = subscription(sub, customer, tenant);
  const reader = { subscriptions: { retrieve: async () => latest } } as unknown as Pick<Stripe, "subscriptions">;
  const events = [event(`evt_z_${tenant}`, subscription(sub, customer, tenant, "active")), event(`evt_a_${tenant}`, latest)];
  expect(await Promise.all(events.map(e => applyStripeEvent(e, reader)))).toEqual(["applied", "applied"]);
  const [row] = await sql`select status,cancel_at_period_end from subscriptions where establishment_id=${tenant}`;
  expect(row).toMatchObject({status:"canceled",cancel_at_period_end:true});
});

test.afterAll(async () => { await sql.end(); });
