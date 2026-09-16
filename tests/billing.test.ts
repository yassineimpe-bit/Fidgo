import { describe, expect, it } from "vitest";
import { getBillingRuntimeStatus, isBillingInterval } from "../lib/billing";

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
