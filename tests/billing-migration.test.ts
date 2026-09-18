import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("db/migrations/013_stripe_billing_v2.sql", "utf8");
const schema = readFileSync("db/schema.sql", "utf8");

describe("migration Stripe v2", () => {
  it("utilise le numéro 013 sans modifier l'historique 009-012", () => {
    expect(migration).toContain("stripe_webhook_events");
    expect(migration).not.toContain("STRIPE_PRICE");
    expect(migration).not.toMatch(/alter table (transactions|cards|wallet_passes|product_events|audit_logs)/i);
  });

  it("est rejouable et protège les identifiants Stripe", () => {
    expect(migration).toMatch(/add column if not exists billing_interval/i);
    expect(migration).toMatch(/create table if not exists stripe_webhook_events/i);
    expect(migration).toMatch(/on conflict \(establishment_id\) do nothing/i);
    expect(migration).toContain("subscriptions_external_customer_unique");
    expect(migration).toContain("subscriptions_external_subscription_unique");
    expect(migration).toContain("subscriptions_checkout_session_unique");
    expect(migration).toMatch(/legacy_plan = coalesce\(legacy_plan, plan\)/i);
  });

  it("garde le schéma de référence aligné sans donnée bancaire", () => {
    expect(schema).toContain("stripe_last_event_created");
    expect(schema).toContain("external_subscription_id");
    expect(schema).not.toMatch(/card_number|card_cvc|payment_method_secret/i);
  });
});
