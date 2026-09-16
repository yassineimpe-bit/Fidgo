import Stripe from "stripe";
import { sql } from "@/lib/db";
import { getAppUrl } from "@/lib/app-url";

export const TRIAL_DAYS = 30;
export const PRICE_MONTHLY_EUR_HT = 29;
export const PRICE_ANNUAL_EUR_HT = 290;

export type BillingInterval = "monthly" | "annual";
export type SubscriptionStatus = "trial" | "active" | "past_due" | "cancelled";

export function isBillingInterval(value: unknown): value is BillingInterval {
  return value === "monthly" || value === "annual";
}

export function billingEnabled() {
  return process.env.STRIPE_ENABLED === "true";
}

export type BillingRuntimeStatus = {
  enabled: boolean;
  configured: boolean;
  missing: string[];
};

const REQUIRED_STRIPE_ENV = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_MONTHLY", "STRIPE_PRICE_ANNUAL"] as const;

export function getBillingRuntimeStatus(env: Record<string, string | undefined> = process.env): BillingRuntimeStatus {
  const enabled = env.STRIPE_ENABLED === "true";
  const missing = REQUIRED_STRIPE_ENV.filter((key) => !env[key]?.trim());
  return { enabled, configured: enabled && missing.length === 0, missing };
}

let cachedClient: Stripe | null = null;

function stripeClient(): Stripe {
  const status = getBillingRuntimeStatus();
  if (!status.configured) throw new Error("STRIPE_NOT_CONFIGURED");
  if (!cachedClient) cachedClient = new Stripe(process.env.STRIPE_SECRET_KEY as string);
  return cachedClient;
}

function priceIdFor(interval: BillingInterval): string {
  const priceId = interval === "monthly" ? process.env.STRIPE_PRICE_MONTHLY : process.env.STRIPE_PRICE_ANNUAL;
  if (!priceId) throw new Error("STRIPE_NOT_CONFIGURED");
  return priceId;
}

/**
 * Un seul abonnement par commerce : cree en essai (30 jours) des l'inscription.
 * Le paiement Stripe reel n'intervient que si STRIPE_ENABLED est actif.
 */
export async function createTrialSubscription(
  tx: typeof sql,
  establishmentId: string,
  billingInterval: BillingInterval,
) {
  await tx`
    insert into subscriptions (establishment_id, plan, billing_interval, status, trial_ends_at)
    values (${establishmentId}, 'FIDGO', ${billingInterval}, 'trial', now() + (${TRIAL_DAYS}::int * interval '1 day'))
    on conflict (establishment_id) do nothing
  `;
}

export async function getSubscription(establishmentId: string) {
  const [row] = await sql`
    select provider, external_customer_id, external_subscription_id, plan, billing_interval,
           status, trial_ends_at, current_period_end, cancel_at_period_end
    from subscriptions
    where establishment_id = ${establishmentId}
    limit 1
  `;
  return row ?? null;
}

/**
 * Checkout Stripe en mode abonnement, avec essai de TRIAL_DAYS jours et
 * codes promo activables (offres fondateurs) sans palier fonctionnel dedie.
 */
export async function createCheckoutSession(input: {
  establishmentId: string;
  email: string;
  interval: BillingInterval;
}) {
  const stripe = stripeClient();
  const appUrl = getAppUrl();
  return stripe.checkout.sessions.create({
    mode: "subscription",
    customer_email: input.email,
    client_reference_id: input.establishmentId,
    line_items: [{ price: priceIdFor(input.interval), quantity: 1 }],
    subscription_data: {
      trial_period_days: TRIAL_DAYS,
      metadata: { establishmentId: input.establishmentId },
    },
    allow_promotion_codes: true,
    success_url: `${appUrl}/dashboard/billing?checkout=success`,
    cancel_url: `${appUrl}/dashboard/billing?checkout=cancelled`,
    metadata: { establishmentId: input.establishmentId },
  });
}

export async function createBillingPortalSession(customerId: string) {
  const stripe = stripeClient();
  const appUrl = getAppUrl();
  return stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${appUrl}/dashboard/billing`,
  });
}

export function constructWebhookEvent(payload: string, signature: string): Stripe.Event {
  const stripe = stripeClient();
  return stripe.webhooks.constructEvent(payload, signature, process.env.STRIPE_WEBHOOK_SECRET as string);
}

function mapStripeStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  switch (status) {
    case "trialing":
      return "trial";
    case "active":
      return "active";
    case "canceled":
      return "cancelled";
    default:
      return "past_due";
  }
}

export async function applyStripeEvent(event: Stripe.Event) {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const establishmentId = session.client_reference_id || session.metadata?.establishmentId || null;
    if (!establishmentId) return;
    const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
    const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null;
    await sql`
      update subscriptions
      set external_customer_id = coalesce(${customerId}, external_customer_id),
          external_subscription_id = coalesce(${subscriptionId}, external_subscription_id),
          updated_at = now()
      where establishment_id = ${establishmentId}
    `;
    return;
  }

  if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const subscription = event.data.object as Stripe.Subscription;
    const establishmentId = subscription.metadata?.establishmentId || null;
    const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id ?? null;
    const currentPeriodEnd = subscription.items.data[0]?.current_period_end;
    const periodEnd = currentPeriodEnd ? new Date(currentPeriodEnd * 1000) : null;
    const status = mapStripeStatus(subscription.status);
    if (establishmentId) {
      await sql`
        update subscriptions
        set status = ${status},
            external_subscription_id = ${subscription.id},
            external_customer_id = coalesce(${customerId}, external_customer_id),
            current_period_end = ${periodEnd},
            cancel_at_period_end = ${subscription.cancel_at_period_end},
            updated_at = now()
        where establishment_id = ${establishmentId}
      `;
    } else {
      await sql`
        update subscriptions
        set status = ${status},
            current_period_end = ${periodEnd},
            cancel_at_period_end = ${subscription.cancel_at_period_end},
            updated_at = now()
        where external_subscription_id = ${subscription.id}
      `;
    }
  }
}
