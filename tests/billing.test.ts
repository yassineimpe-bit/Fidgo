import { describe, expect, it } from "vitest";
import { checkoutTrialEnd, getBillingRuntimeStatus, isBillingInterval } from "../lib/billing";

describe("billing runtime status", () => {
  it("reports disabled by default", () => {
    const status = getBillingRuntimeStatus({});
    expect(status.enabled).toBe(false);
    expect(status.configured).toBe(false);
  });

  it("reports enabled but not configured when keys are missing", () => {
    const status = getBillingRuntimeStatus({ STRIPE_ENABLED: "true" });
    expect(status.enabled).toBe(true);
    expect(status.configured).toBe(false);
    expect(status.missing).toEqual(expect.arrayContaining([
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "STRIPE_PRICE_MONTHLY",
      "STRIPE_PRICE_ANNUAL",
    ]));
  });

  it("reports configured once every required key is present", () => {
    const status = getBillingRuntimeStatus({
      STRIPE_ENABLED: "true",
      STRIPE_SECRET_KEY: "sk_test_123",
      STRIPE_WEBHOOK_SECRET: "whsec_123",
      STRIPE_PRICE_MONTHLY: "price_monthly",
      STRIPE_PRICE_ANNUAL: "price_annual",
    });
    expect(status.configured).toBe(true);
    expect(status.missing).toEqual([]);
  });
});

describe("billing interval", () => {
  it("accepts monthly and annual only", () => {
    expect(isBillingInterval("monthly")).toBe(true);
    expect(isBillingInterval("annual")).toBe(true);
    expect(isBillingInterval("yearly")).toBe(false);
    expect(isBillingInterval(undefined)).toBe(false);
  });
});

describe("checkout trial deadline", () => {
  const now = Date.UTC(2026, 8, 16, 8, 0, 0);

  it("preserves the original trial end instead of granting another 30 days", () => {
    const end = new Date(now + 10 * 24 * 60 * 60 * 1000);
    expect(checkoutTrialEnd(end, now)).toBe(Math.floor(end.getTime() / 1000));
  });

  it("does not extend a trial when Stripe can no longer accept the original deadline", () => {
    const end = new Date(now + 24 * 60 * 60 * 1000);
    expect(checkoutTrialEnd(end, now)).toBeNull();
  });

  it("ignores missing or invalid trial dates", () => {
    expect(checkoutTrialEnd(null, now)).toBeNull();
    expect(checkoutTrialEnd("not-a-date", now)).toBeNull();
  });
});
