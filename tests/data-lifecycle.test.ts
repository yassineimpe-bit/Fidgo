import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("db/migrations/012_data_lifecycle.sql", "utf8");
const purge = readFileSync("scripts/purge-data-lifecycle.mjs", "utf8");

describe("data lifecycle database contract", () => {
  it("uses migration 012 without touching Stripe history", () => {
    expect(migration).toContain("customers_erased_pii_check");
    expect(migration).not.toMatch(/stripe/i);
  });

  it("protects ledger roots from hard deletion and revokes derived credentials", () => {
    expect(migration).toContain("establishments_no_hard_delete");
    expect(migration).toContain("customers_no_hard_delete");
    expect(migration).toContain("cards_no_hard_delete");
    expect(migration).toContain("update card_recovery_tokens");
    expect(migration).toContain("update wallet_passes");
    expect(migration).toContain("row_number() over (partition by card_id");
    expect(migration).toContain("metadata=metadata - 'reason' - 'overrideReason'");
    expect(migration).not.toMatch(/delete\s+from\s+transactions/i);
  });

  it("keeps maintenance purges bounded and excludes business ledger tables", () => {
    expect(purge).toContain("const batch = 5_000");
    expect(purge).toContain("--execute");
    expect(purge).toContain("pg_try_advisory_lock");
    expect(purge).not.toMatch(/delete\s+from\s+transactions/i);
    expect(purge).not.toMatch(/delete\s+from\s+cards/i);
    expect(purge).not.toMatch(/delete\s+from\s+customers/i);
  });
});
