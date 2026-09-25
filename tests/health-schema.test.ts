import { describe, expect, it } from "vitest";
import { healthSchemaIsReady } from "@/lib/health-schema";

const coreSchema = {
  recovery_table: true,
  onboarding_step: true,
  password_reset_table: true,
  email_verification_table: true,
  email_verified_at: true,
  legal_acceptances_table: true,
  staff_marketing_consent: true,
  product_events_table: true,
  token_version: true,
  last_earn_at: true,
  cooldown_seconds: true,
  tenant_integrity: true,
  reversal_once: true,
  lifecycle_guards: true,
  erased_pii_check: true,
  stripe_webhook_events_table: false,
  billing_trial_end: false,
};

describe("health schema", () => {
  it("échoue fermé si la migration onboarding 020 manque", () => {
    expect(healthSchemaIsReady({ ...coreSchema, onboarding_step: false }, false)).toBe(false);
  });

  it("échoue fermé si la migration password reset 015 manque", () => {
    expect(healthSchemaIsReady({ ...coreSchema, password_reset_table: false }, false)).toBe(false);
  });

  it("échoue fermé si la migration email verification 021 manque", () => {
    expect(healthSchemaIsReady({ ...coreSchema, email_verification_table: false }, false)).toBe(false);
    expect(healthSchemaIsReady({ ...coreSchema, email_verified_at: false }, false)).toBe(false);
  });

  it("échoue fermé si la migration légale 022 manque", () => {
    expect(healthSchemaIsReady({ ...coreSchema, legal_acceptances_table: false }, false)).toBe(false);
    expect(healthSchemaIsReady({ ...coreSchema, staff_marketing_consent: false }, false)).toBe(false);
  });

  describe("Stripe optionnel", () => {
    it("reste vert avant migration 013 lorsque Stripe est désactivé", () => {
      expect(healthSchemaIsReady(coreSchema, false)).toBe(true);
    });

    it("échoue fermé si Stripe est activé avant migration 013", () => {
      expect(healthSchemaIsReady(coreSchema, true)).toBe(false);
      expect(healthSchemaIsReady({
        ...coreSchema,
        stripe_webhook_events_table: true,
        billing_trial_end: true,
      }, true)).toBe(true);
    });
  });
});
