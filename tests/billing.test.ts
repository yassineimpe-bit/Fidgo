import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import {
  BILLING_PLANS,
  BillingInputError,
  type BillingStripeClient,
  checkoutPlanFromRequest,
  checkoutTrialEnd,
  createPilotSubscription,
  createBillingPortalSession,
  createCheckoutSession,
  getBillingRuntimeStatus,
  mapStripeStatus,
  planFromStripePriceId,
} from "@/lib/billing";
import { safeErrorCode } from "@/lib/observability";

const configuredEnv = {
  STRIPE_ENABLED: "true",
  STRIPE_SECRET_KEY: "sk_test_placeholder",
  STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
  STRIPE_PRICE_FLEX_MONTHLY: "price_flex",
  STRIPE_PRICE_RETIKO12_MONTHLY: "price_retiko12",
  STRIPE_PRICE_ANNUAL: "price_annual",
};

beforeEach(() => {
  Object.assign(process.env, configuredEnv, { NEXT_PUBLIC_APP_URL: "https://retiko.test" });
});

describe("configuration Stripe v2", () => {
  it("reste désactivée par défaut", () => {
    expect(getBillingRuntimeStatus({})).toEqual({ enabled: false, configured: false, missing: expect.any(Array), invalid: [] });
  });

  it("exige les trois Price IDs distincts lorsque Stripe est activé", () => {
    expect(getBillingRuntimeStatus({ STRIPE_ENABLED: "true" }).configured).toBe(false);
    expect(getBillingRuntimeStatus(configuredEnv)).toMatchObject({ enabled: true, configured: true, missing: [], invalid: [] });
    expect(getBillingRuntimeStatus({
      ...configuredEnv,
      STRIPE_PRICE_ANNUAL: configuredEnv.STRIPE_PRICE_FLEX_MONTHLY,
    }).invalid).toContain("STRIPE_PRICE_IDS_DUPLICATED");
  });

  it("associe uniquement les Price IDs serveur aux offres Retiko", () => {
    expect(planFromStripePriceId("price_flex", configuredEnv)).toBe("FLEX");
    expect(planFromStripePriceId("price_retiko12", configuredEnv)).toBe("RETIKO_12");
    expect(planFromStripePriceId("price_annual", configuredEnv)).toBe("ANNUAL");
    expect(planFromStripePriceId("price_attacker", configuredEnv)).toBeNull();
  });
});

describe("compatibilité avant migration 013", () => {
  it("crée l'état pilote avec le schéma historique lorsque Stripe reste désactivé", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([{ billing_v2: false }])
      .mockResolvedValueOnce([{ id: "sub_legacy", trial_ends_at: null }]);
    const subscription = await createPilotSubscription(
      query as unknown as Parameters<typeof createPilotSubscription>[0],
      "11111111-1111-4111-8111-111111111111",
    );
    expect(subscription).toMatchObject({ id: "sub_legacy", trial_ends_at: null });
    const legacyInsert = Array.from(query.mock.calls[1][0] as readonly string[]).join(" ");
    expect(legacyInsert).toContain("insert into subscriptions (establishment_id)");
    expect(legacyInsert).not.toContain("'PILOT'");
  });
});

describe("entrée Checkout", () => {
  it("rejette tout Price ID fourni par le navigateur", () => {
    expect(() => checkoutPlanFromRequest({ plan: "FLEX", priceId: "price_attacker" }))
      .toThrowError(expect.objectContaining({ code: "CLIENT_PRICE_NOT_ALLOWED" }) as BillingInputError);
    expect(() => checkoutPlanFromRequest({ plan: "UNKNOWN" }))
      .toThrowError(expect.objectContaining({ code: "INVALID_PLAN" }) as BillingInputError);
  });

  it("crée une Checkout Session avec le prix serveur et l'essai existant", async () => {
    const create = vi.fn(async (
      _params: Stripe.Checkout.SessionCreateParams,
      _options?: Stripe.RequestOptions,
    ) => {
      void _params;
      void _options;
      return { id: "cs_test", url: "https://checkout.stripe.test/session" };
    });
    const client = {
      checkout: { sessions: { create } },
      billingPortal: { sessions: { create: vi.fn() } },
      webhooks: { constructEvent: vi.fn() },
    } as unknown as BillingStripeClient;
    const trialEndsAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);

    const result = await createCheckoutSession({
      establishmentId: "11111111-1111-4111-8111-111111111111",
      email: "owner@example.com",
      plan: "RETIKO_12",
      trialEndsAt,
      idempotencyKey: "retiko-checkout-test",
    }, client);

    expect(result.url).toContain("checkout.stripe.test");
    const [params, options] = create.mock.calls[0];
    expect(params.line_items).toEqual([{ price: "price_retiko12", quantity: 1 }]);
    expect(params.billing_address_collection).toBe("required");
    expect(params.tax_id_collection).toEqual({ enabled: true });
    expect(params.subscription_data?.metadata).toMatchObject({ retikoPlan: "RETIKO_12" });
    expect(params.subscription_data?.trial_end).toBe(checkoutTrialEnd(trialEndsAt));
    expect(params.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000) + 30 * 60);
    expect(params.expires_at).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 31 * 60);
    expect(options).toEqual({ idempotencyKey: "retiko-checkout-test" });
    expect(JSON.stringify(params)).not.toContain("sk_test_placeholder");
  });

  it("crée un portail pour le client Stripe déjà lié", async () => {
    const create = vi.fn(async () => ({ id: "bps_test", url: "https://billing.stripe.test/portal" }));
    const client = {
      checkout: { sessions: { create: vi.fn() } },
      billingPortal: { sessions: { create } },
      webhooks: { constructEvent: vi.fn() },
    } as unknown as BillingStripeClient;
    await expect(createBillingPortalSession("cus_test", client)).resolves.toMatchObject({ id: "bps_test" });
    expect(create).toHaveBeenCalledWith({ customer: "cus_test", return_url: "https://retiko.test/dashboard/billing" });
  });

  it("ne recrée pas un essai Stripe lorsque le pilote expire dans moins de 48 h", () => {
    const nearExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
    expect(checkoutTrialEnd(nearExpiry)).toBeNull();
  });
});

describe("synchronisation d'abonnement", () => {
  it.each([
    ["trialing", "trial"],
    ["active", "active"],
    ["past_due", "past_due"],
    ["canceled", "canceled"],
    ["unpaid", "unpaid"],
    ["incomplete", "unpaid"],
  ] as Array<[Stripe.Subscription.Status, string]>)("mappe %s vers %s", (stripeStatus, expected) => {
    expect(mapStripeStatus(stripeStatus)).toBe(expected);
  });

  it("ne met jamais une erreur fournisseur brute dans un code de log", () => {
    const code = safeErrorCode(new Error("request failed with sk_test_super_secret and card details"), "STRIPE_FAILED");
    expect(code).toMatch(/^STRIPE_FAILED_/);
    expect(code).not.toContain("secret");
    expect(code).not.toContain("card");
  });

  it("conserve les tarifs commerciaux attendus", () => {
    expect(BILLING_PLANS.FLEX.priceLabel).toBe("24,99 € HT/mois");
    expect(BILLING_PLANS.RETIKO_12.priceLabel).toBe("19,99 € HT/mois");
    expect(BILLING_PLANS.ANNUAL.priceLabel).toBe("210 € HT/an");
  });
});
