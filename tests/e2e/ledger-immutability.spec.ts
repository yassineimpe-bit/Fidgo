import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { createMerchant, enrollCustomer, origin, unique } from "./helpers";

function postgresCode(error: unknown) {
  return typeof error === "object" && error && "code" in error
    ? String((error as { code: unknown }).code)
    : "";
}

async function expectLedgerBlocked(operation: Promise<unknown>) {
  try {
    await operation;
    throw new Error("Expected immutable-ledger rejection");
  } catch (error) {
    expect(postgresCode(error)).toBe("55000");
  }
}

test("ledger : champs financiers append-only et seule la redaction RGPD des motifs reste autorisée", async ({ page }) => {
  await createMerchant(page, "ledger-immutable");
  const card = await enrollCustomer(page, "Ledger", `${unique("ledger")}@example.com`);
  const token = card.cardUrl.split("/c/")[1];
  const credit = await page.request.post("/api/credit", {
    headers: { origin },
    data: { token, idempotencyKey: crypto.randomUUID() },
  });
  expect(credit.ok()).toBeTruthy();

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const [earned] = await sql`
      select t.id,t.delta,t.balance_after,t.metadata,c.customer_id
      from transactions t join cards c on c.id=t.card_id
      where c.token=${token} and t.type='earn'
      order by t.created_at desc limit 1
    `;
    expect(earned).toBeTruthy();

    await expectLedgerBlocked(sql`
      update transactions set delta=delta+1 where id=${earned.id}
    `);
    await expectLedgerBlocked(sql`
      update transactions set metadata=metadata || '{"tampered":true}'::jsonb where id=${earned.id}
    `);
    await expectLedgerBlocked(sql`
      delete from transactions where id=${earned.id}
    `);

    const adjusted = await page.request.post(`/api/customers/${earned.customer_id}/adjust`, {
      headers: { origin },
      data: { newBalance: 3, reason: "Motif RGPD à retirer", idempotencyKey: crypto.randomUUID() },
    });
    expect(adjusted.ok()).toBeTruthy();

    const [adjustment] = await sql`
      select id,delta,balance_after,metadata
      from transactions
      where card_id=(select id from cards where token=${token}) and type='adjust'
      order by created_at desc limit 1
    `;
    expect(adjustment.metadata.reason).toBe("Motif RGPD à retirer");

    await sql`
      update transactions
      set metadata=metadata - 'reason' - 'overrideReason'
      where id=${adjustment.id}
    `;
    const [redacted] = await sql`
      select delta,balance_after,metadata from transactions where id=${adjustment.id}
    `;
    expect(Number(redacted.delta)).toBe(Number(adjustment.delta));
    expect(Number(redacted.balance_after)).toBe(Number(adjustment.balance_after));
    expect(redacted.metadata).not.toHaveProperty("reason");
    expect(redacted.metadata).not.toHaveProperty("overrideReason");
  } finally {
    await sql.end({ timeout: 5 });
  }
});
