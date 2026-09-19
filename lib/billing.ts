import Stripe from "stripe";
import { getAppUrl } from "@/lib/app-url";
import { sql } from "@/lib/db";

export const BILLING_TRIAL_DAYS = 30;
const STRIPE_MIN_TRIAL_AHEAD_SECONDS = 48 * 60 * 60;
const STRIPE_CHECKOUT_LIFETIME_SECONDS = 31 * 60;

export const BILLING_PLANS = {
  FLEX: {
    label: "Retiko Flex",
    priceLabel: "24,99 € HT/mois",
    billingInterval: "monthly",
    priceEnv: "STRIPE_PRICE_FLEX_MONTHLY",
    commitment: "Sans engagement",
  },
  RETIKO_12: {
    label: "Retiko 12",
    priceLabel: "19,99 € HT/mois",
    billingInterval: "monthly",
    priceEnv: "STRIPE_PRICE_RETIKO12_MONTHLY",
    commitment: "Engagement commercial de 12 mois",
  },
  ANNUAL: {
    label: "Retiko annuel",
    priceLabel: "210 € HT/an",
    billingInterval: "annual",
    priceEnv: "STRIPE_PRICE_ANNUAL",
    commitment: "Facturation annuelle",
  },
} as const;

export type BillingPlan = keyof typeof BILLING_PLANS;
export type BillingInterval = "monthly" | "annual";
export type SubscriptionStatus = "trial" | "active" | "past_due" | "canceled" | "unpaid";

const REQUIRED_STRIPE_ENV = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_FLEX_MONTHLY",
  "STRIPE_PRICE_RETIKO12_MONTHLY",
  "STRIPE_PRICE_ANNUAL",
] as const;

export type BillingRuntimeStatus = {
  enabled: boolean;
  configured: boolean;
  missing: string[];
  invalid: string[];
};

export function billingEnabled(env: Record<string, string | undefined> = process.env) {
  return env.STRIPE_ENABLED === "true";
}

export function stripeAutomaticTaxEnabled(env: Record<string, string | undefined> = process.env) {
  return env.STRIPE_AUTOMATIC_TAX_ENABLED === "true";
}

export function getBillingRuntimeStatus(
  env: Record<string, string | undefined> = process.env,
): BillingRuntimeStatus {
  const enabled = billingEnabled(env);
  const missing = REQUIRED_STRIPE_ENV.filter((key) => !env[key]?.trim());
  const invalid: string[] = [];
  if (enabled && env.STRIPE_SECRET_KEY && !env.STRIPE_SECRET_KEY.startsWith("sk_")) {
    invalid.push("STRIPE_SECRET_KEY");
  }
  if (enabled && env.STRIPE_WEBHOOK_SECRET && !env.STRIPE_WEBHOOK_SECRET.startsWith("whsec_")) {
    invalid.push("STRIPE_WEBHOOK_SECRET");
  }
  const priceIds = [
    env.STRIPE_PRICE_FLEX_MONTHLY,
    env.STRIPE_PRICE_RETIKO12_MONTHLY,
    env.STRIPE_PRICE_ANNUAL,
  ].filter((value): value is string => Boolean(value?.trim()));
  if (enabled && priceIds.some((value) => !value.startsWith("price_"))) invalid.push("STRIPE_PRICE_IDS");
  if (enabled && new Set(priceIds).size !== priceIds.length) invalid.push("STRIPE_PRICE_IDS_DUPLICATED");
  return { enabled, configured: enabled && missing.length === 0 && invalid.length === 0, missing, invalid };
}

export function isBillingPlan(value: unknown): value is BillingPlan {
  return typeof value === "string" && Object.hasOwn(BILLING_PLANS, value);
}

export class BillingInputError extends Error {
  constructor(public readonly code: "INVALID_PLAN" | "CLIENT_PRICE_NOT_ALLOWED") {
    super(code);
    this.name = "BillingInputError";
  }
}

export function checkoutPlanFromRequest(value: unknown): BillingPlan {
  const body = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if ("price" in body || "priceId" in body || "price_id" in body) {
    throw new BillingInputError("CLIENT_PRICE_NOT_ALLOWED");
  }
  if (!isBillingPlan(body.plan)) throw new BillingInputError("INVALID_PLAN");
  return body.plan;
}

export function checkoutTrialEnd(
  value: Date | string | null | undefined,
  nowMs = Date.now(),
): number | null {
  if (!value) return null;
  const dateMs = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(dateMs)) return null;
  const trialEndSeconds = Math.floor(dateMs / 1000);
  const nowSeconds = Math.floor(nowMs / 1000);
  return trialEndSeconds - nowSeconds >= STRIPE_MIN_TRIAL_AHEAD_SECONDS ? trialEndSeconds : null;
}

export type BillingStripeClient = Pick<Stripe, "checkout" | "billingPortal" | "webhooks">;

let cachedClient: Stripe | null = null;
let cachedSecret = "";

function stripeClient(): Stripe {
  const runtime = getBillingRuntimeStatus();
  if (!runtime.configured) throw new Error("STRIPE_NOT_CONFIGURED");
  const secret = process.env.STRIPE_SECRET_KEY as string;
  if (!cachedClient || cachedSecret !== secret) {
    cachedClient = new Stripe(secret, { maxNetworkRetries: 2, timeout: 10_000 });
    cachedSecret = secret;
  }
  return cachedClient;
}

export function priceIdForPlan(
  plan: BillingPlan,
  env: Record<string, string | undefined> = process.env,
): string {
  const priceId = env[BILLING_PLANS[plan].priceEnv]?.trim();
  if (!priceId) throw new Error("STRIPE_NOT_CONFIGURED");
  return priceId;
}

export function planFromStripePriceId(
  priceId: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): BillingPlan | null {
  if (!priceId) return null;
  return (Object.keys(BILLING_PLANS) as BillingPlan[]).find(
    (plan) => env[BILLING_PLANS[plan].priceEnv]?.trim() === priceId,
  ) ?? null;
}

export function mapStripeStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  switch (status) {
    case "trialing": return "trial";
    case "active": return "active";
    case "past_due": return "past_due";
    case "canceled": return "canceled";
    case "unpaid":
    case "incomplete":
    case "incomplete_expired": return "unpaid";
    case "paused": return "past_due";
    default: return "unpaid";
  }
}

export async function billingSchemaSupportsV2(query: typeof sql = sql) {
  const [schema] = await query`
    select exists(
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'subscriptions'
        and column_name = 'trial_ends_at'
    ) as billing_v2
  `;
  return Boolean(schema?.billing_v2);
}

export async function createPilotSubscription(tx: typeof sql, establishmentId: string) {
  if (!await billingSchemaSupportsV2(tx)) {
    const [legacySubscription] = await tx`
      insert into subscriptions (establishment_id)
      values (${establishmentId})
      on conflict (establishment_id) do nothing
      returning id, null::timestamptz as trial_ends_at
    `;
    return legacySubscription ?? null;
  }
  const [subscription] = await tx`
    insert into subscriptions (establishment_id, plan, status, trial_ends_at)
    values (${establishmentId}, 'PILOT', 'trial', now() + (${BILLING_TRIAL_DAYS}::int * interval '1 day'))
    on conflict (establishment_id) do nothing
    returning id, trial_ends_at
  `;
  return subscription ?? null;
}

export async function getSubscription(establishmentId: string) {
  if (!await billingSchemaSupportsV2()) {
    const [legacyRow] = await sql`
      select provider, external_customer_id, external_subscription_id, plan,
             null::text as billing_interval, status, null::timestamptz as trial_ends_at,
             current_period_end, false as cancel_at_period_end
      from subscriptions
      where establishment_id = ${establishmentId}
      limit 1
    `;
    return legacyRow ?? null;
  }
  const [row] = await sql`
    select provider, external_customer_id, external_subscription_id, plan,
           billing_interval, status, trial_ends_at, current_period_end,
           cancel_at_period_end
    from subscriptions
    where establishment_id = ${establishmentId}
    limit 1
  `;
  return row ?? null;
}

export async function createCheckoutSession(input: {
  establishmentId: string;
  email: string;
  plan: BillingPlan;
  trialEndsAt?: Date | string | null;
  customerId?: string | null;
  idempotencyKey: string;
}, client: BillingStripeClient = stripeClient()) {
  const appUrl = getAppUrl();
  if (!appUrl) throw new Error("APP_URL_NOT_CONFIGURED");
  const trialEnd = checkoutTrialEnd(input.trialEndsAt);
  return client.checkout.sessions.create({
    mode: "subscription",
    billing_address_collection: "required",
    tax_id_collection: { enabled: true },
    automatic_tax: { enabled: stripeAutomaticTaxEnabled() },
    ...(input.customerId
      ? { customer: input.customerId, customer_update: { address: "auto" as const } }
      : { customer_email: input.email }),
    client_reference_id: input.establishmentId,
    line_items: [{ price: priceIdForPlan(input.plan), quantity: 1 }],
    subscription_data: {
      ...(trialEnd ? { trial_end: trialEnd } : {}),
      metadata: { establishmentId: input.establishmentId, retikoPlan: input.plan },
    },
    metadata: { establishmentId: input.establishmentId, retikoPlan: input.plan },
    expires_at: Math.floor(Date.now() / 1000) + STRIPE_CHECKOUT_LIFETIME_SECONDS,
    success_url: `${appUrl}/dashboard/billing?checkout=success`,
    cancel_url: `${appUrl}/dashboard/billing?checkout=canceled`,
  }, { idempotencyKey: input.idempotencyKey });
}

export async function createBillingPortalSession(
  customerId: string,
  client: BillingStripeClient = stripeClient(),
) {
  const appUrl = getAppUrl();
  if (!appUrl) throw new Error("APP_URL_NOT_CONFIGURED");
  return client.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${appUrl}/dashboard/billing`,
  });
}

export async function expireCheckoutSession(
  sessionId: string,
  client: BillingStripeClient = stripeClient(),
) {
  return client.checkout.sessions.expire(sessionId);
}

export function constructWebhookEvent(
  payload: string,
  signature: string,
  client: BillingStripeClient = stripeClient(),
): Stripe.Event {
  return client.webhooks.constructEvent(
    payload,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET as string,
  );
}

function stripeId(value: string | { id: string } | Stripe.DeletedCustomer | null): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

function eventIsNewer(event: Stripe.Event, lastCreated: unknown, lastId: unknown) {
  if (lastCreated === null || lastCreated === undefined) return true;
  const previousCreated = Number(lastCreated);
  if (event.created !== previousCreated) return event.created > previousCreated;
  return event.id > String(lastId || "");
}

export type StripeEventApplyResult = "applied" | "duplicate" | "ignored";

export async function applyStripeEvent(event: Stripe.Event): Promise<StripeEventApplyResult> {
  return sql.begin(async (tx) => {
    const inserted = await tx`
      insert into stripe_webhook_events (event_id, event_type, event_created)
      values (${event.id}, ${event.type}, ${event.created})
      on conflict (event_id) do nothing
      returning event_id
    `;
    if (inserted.length === 0) return "duplicate" as const;

    if (event.type === "checkout.session.completed") {
      const checkout = event.data.object as Stripe.Checkout.Session;
      const referenceId = checkout.client_reference_id;
      const metadataId = checkout.metadata?.establishmentId || null;
      const customerId = stripeId(checkout.customer);
      const subscriptionId = stripeId(checkout.subscription);
      const [target] = await tx`
        select establishment_id, stripe_checkout_plan
        from subscriptions
        where stripe_checkout_session_id = ${checkout.id}
        for update
      `;
      if (!target) throw new Error("STRIPE_CHECKOUT_UNBOUND");
      const establishmentId = String(target.establishment_id);
      const plan = target.stripe_checkout_plan;
      if (!referenceId || referenceId !== establishmentId || (metadataId && metadataId !== establishmentId)) {
        throw new Error("STRIPE_TENANT_MISMATCH");
      }
      if (checkout.metadata?.retikoPlan && checkout.metadata.retikoPlan !== plan) {
        throw new Error("STRIPE_PLAN_MISMATCH");
      }
      if (!customerId || !subscriptionId || !isBillingPlan(plan)) throw new Error("STRIPE_CHECKOUT_INCOMPLETE");
      const definition = BILLING_PLANS[plan];
      const updated = await tx`
        update subscriptions
        set external_customer_id = ${customerId},
            stripe_last_event_created = case when external_subscription_id is distinct from ${subscriptionId} then null else stripe_last_event_created end,
            stripe_last_event_id = case when external_subscription_id is distinct from ${subscriptionId} then null else stripe_last_event_id end,
            external_subscription_id = ${subscriptionId},
            plan = ${plan},
            billing_interval = ${definition.billingInterval},
            stripe_checkout_claim_token = null,
            stripe_checkout_pending_at = null,
            updated_at = now()
        where establishment_id = ${establishmentId}
          and stripe_checkout_session_id = ${checkout.id}
          and (external_customer_id is null or external_customer_id = ${customerId})
          and (external_subscription_id is null or external_subscription_id = ${subscriptionId} or status = 'canceled')
        returning establishment_id
      `;
      if (updated.length !== 1) throw new Error("STRIPE_TENANT_MISMATCH");
      await tx`
        update stripe_webhook_events
        set establishment_id = ${establishmentId}, external_subscription_id = ${subscriptionId}
        where event_id = ${event.id}
      `;
      return "applied" as const;
    }

    if (
      event.type !== "customer.subscription.created"
      && event.type !== "customer.subscription.updated"
      && event.type !== "customer.subscription.deleted"
    ) return "ignored" as const;

    const subscription = event.data.object as Stripe.Subscription;
    const metadataId = subscription.metadata?.establishmentId || null;
    const customerId = stripeId(subscription.customer);
    const firstItem = subscription.items.data[0];
    const plan = planFromStripePriceId(firstItem?.price?.id);
    if (!customerId || !plan) throw new Error("STRIPE_PRICE_OR_CUSTOMER_UNKNOWN");

    const byExternal = await tx`
      select establishment_id, external_customer_id, external_subscription_id,
             stripe_last_event_created, stripe_last_event_id
      from subscriptions
      where external_subscription_id = ${subscription.id}
      for update
    `;
    const target = byExternal[0];
    if (target && metadataId && String(target.establishment_id) !== metadataId) {
      throw new Error("STRIPE_TENANT_MISMATCH");
    }
    if (!target) throw new Error("STRIPE_SUBSCRIPTION_UNBOUND");
    if (!target
      || (target.external_customer_id && String(target.external_customer_id) !== customerId)
      || (target.external_subscription_id && String(target.external_subscription_id) !== subscription.id)) {
      throw new Error("STRIPE_TENANT_MISMATCH");
    }

    const establishmentId = String(target.establishment_id);
    if (!eventIsNewer(event, target.stripe_last_event_created, target.stripe_last_event_id)) {
      await tx`
        update stripe_webhook_events
        set establishment_id = ${establishmentId}, external_subscription_id = ${subscription.id}
        where event_id = ${event.id}
      `;
      return "ignored" as const;
    }

    const currentPeriodEnd = firstItem?.current_period_end
      ? new Date(firstItem.current_period_end * 1000)
      : null;
    const trialEndsAt = subscription.trial_end ? new Date(subscription.trial_end * 1000) : null;
    const definition = BILLING_PLANS[plan];
    await tx`
      update subscriptions
      set external_customer_id = ${customerId},
          external_subscription_id = ${subscription.id},
          plan = ${plan},
          billing_interval = ${definition.billingInterval},
          status = ${mapStripeStatus(subscription.status)},
          trial_ends_at = coalesce(${trialEndsAt}, trial_ends_at),
          current_period_end = ${currentPeriodEnd},
          cancel_at_period_end = ${subscription.cancel_at_period_end},
          stripe_last_event_created = ${event.created},
          stripe_last_event_id = ${event.id},
          updated_at = now()
      where establishment_id = ${establishmentId}
    `;
    await tx`
      update stripe_webhook_events
      set establishment_id = ${establishmentId}, external_subscription_id = ${subscription.id}
      where event_id = ${event.id}
    `;
    return "applied" as const;
  });
}
