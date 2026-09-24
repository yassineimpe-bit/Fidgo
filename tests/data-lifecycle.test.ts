import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("db/migrations/012_data_lifecycle.sql", "utf8");
const purge = readFileSync("scripts/purge-data-lifecycle.mjs", "utf8");
const verify = readFileSync("scripts/verify-db-integrity.mjs", "utf8");
const workflow = readFileSync(".github/workflows/data-lifecycle.yml", "utf8");
const employeeRoute = readFileSync("app/api/employees/[id]/route.ts", "utf8");
const restaurantSuspendRoute = readFileSync("app/api/restaurant/suspend/route.ts", "utf8");

describe("data lifecycle database contract", () => {
  it("uses migration 012 without touching Stripe history", () => {
    expect(migration).toContain("customers_erased_pii_check");
    expect(migration).not.toMatch(/stripe/i);
  });

  it("protects ledger roots from hard deletion and revokes derived credentials", () => {
    expect(migration).toContain("establishments_no_hard_delete");
    expect(migration).toContain("customers_no_hard_delete");
    expect(migration).toContain("update card_recovery_tokens");
    expect(migration).toContain("update wallet_passes");
    expect(migration).toContain("row_number() over (partition by card_id");
    expect(migration).toContain("metadata=metadata - 'reason' - 'overrideReason'");
    expect(migration).not.toMatch(/delete\s+from\s+transactions/i);
  });

  it("garde la purge planifiée destructive derrière un flag explicite", () => {
    expect(workflow).toContain("vars.DATA_LIFECYCLE_EXECUTE == 'true'");
    expect(workflow).toContain("github.event_name == 'workflow_dispatch'");
  });

  it("invalide les credentials temporaires lorsqu'un employé est désactivé", () => {
    expect(employeeRoute).toContain("update password_reset_tokens");
    expect(employeeRoute).toContain("update email_verification_tokens");
    expect(employeeRoute).toContain("where staff_user_id=");
    expect(employeeRoute).toContain("if (!nextActive || roleChanged)");
  });

  it("invalide aussi les credentials temporaires à la suspension du commerce", () => {
    expect(restaurantSuspendRoute).toContain("update password_reset_tokens");
    expect(restaurantSuspendRoute).toContain("update email_verification_tokens");
    expect(restaurantSuspendRoute).toContain("select id from staff_users where establishment_id=");
  });

  it("checks active auth credentials against revoked staff/establishments", () => {
    expect(verify).toContain("active_orphan_password_reset_tokens");
    expect(verify).toContain("password_reset_tokens");
    expect(verify).toContain("active_orphan_email_verification_tokens");
    expect(verify).toContain("email_verification_tokens");
  });

  it("keeps maintenance purges bounded and excludes business ledger tables", () => {
    expect(purge).toContain("const batch = 5_000");
    expect(purge).toContain("--execute");
    expect(purge).toContain("pg_try_advisory_lock");
    expect(purge).toContain("password_reset_tokens");
    expect(purge).toContain("passwordResetTokensDays: 30");
    expect(purge).toContain("email_verification_tokens");
    expect(purge).toContain("emailVerificationTokensDays: 30");
    expect(purge).not.toMatch(/delete\s+from\s+transactions/i);
    expect(purge).not.toMatch(/delete\s+from\s+cards/i);
    expect(purge).not.toMatch(/delete\s+from\s+customers/i);
  });
});
