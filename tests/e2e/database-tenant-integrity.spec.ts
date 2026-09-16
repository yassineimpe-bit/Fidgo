import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { createMerchant, enrollCustomer, origin, unique } from "./helpers";

function postgresCode(error: unknown) {
  return typeof error === "object" && error && "code" in error
    ? String((error as { code: unknown }).code)
    : "";
}

async function expectConstraint(rejected: Promise<unknown>, code: "23503" | "23505" | "23514") {
  try {
    await rejected;
    throw new Error(`Expected PostgreSQL error ${code}`);
  } catch (error) {
    expect(postgresCode(error)).toBe(code);
  }
}

test("intégrité DB : aucune référence carte, staff, wallet ou reversal ne traverse un tenant", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

  try {
    await createMerchant(pageA, "db-tenant-a");
    await createMerchant(pageB, "db-tenant-b");
    const cardA = await enrollCustomer(pageA, "Ada", `${unique("db-a")}@example.com`);
    const cardB = await enrollCustomer(pageB, "Blaise", `${unique("db-b")}@example.com`);
    const tokenA = cardA.cardUrl.split("/c/")[1];
    const tokenB = cardB.cardUrl.split("/c/")[1];

    const restaurantA = await (await pageA.request.get("/api/restaurant")).json();
    const restaurantB = await (await pageB.request.get("/api/restaurant")).json();
    const [staffA] = await pageA.request.get("/api/employees").then((response) => response.json());
    const [staffB] = await pageB.request.get("/api/employees").then((response) => response.json());
    const [dbCardA] = await sql`select id,balance from cards where token=${tokenA}`;
    const [dbCardB] = await sql`select id,balance from cards where token=${tokenB}`;

    await expectConstraint(sql`
      insert into product_events(establishment_id,card_id,event_type)
      values(${restaurantA.id},${dbCardB.id},'SCAN_SUCCESS')
    `, "23503");
    await expectConstraint(sql`
      insert into product_events(establishment_id,staff_user_id,event_type)
      values(${restaurantA.id},${staffB.id},'SCAN_SUCCESS')
    `, "23503");
    await expectConstraint(sql`
      insert into audit_logs(establishment_id,staff_user_id,action)
      values(${restaurantA.id},${staffB.id},'CROSS_TENANT_ATTACK')
    `, "23503");
    await expectConstraint(sql`
      insert into audit_logs(establishment_id,staff_user_id,action)
      values(null,${staffB.id},'MISSING_TENANT_ATTACK')
    `, "23514");
    await expectConstraint(sql`
      insert into wallet_passes(establishment_id,card_id,provider,status)
      values(${restaurantA.id},${dbCardB.id},'GOOGLE','active')
    `, "23503");

    // Même en envoyant explicitement des UUID étrangers à /api/events, le
    // serveur dérive establishment/staff de la session A.
    const injectedEvent = await pageA.request.post("/api/events", {
      headers: { origin },
      data: {
        eventType: "QR_DETECTED",
        durationMs: 1,
        source: "qr",
        establishmentId: restaurantB.id,
        staffUserId: staffB.id,
        cardId: dbCardB.id,
      },
    });
    expect(injectedEvent.status()).toBe(202);
    const [storedEvent] = await sql`
      select establishment_id,staff_user_id,card_id
      from product_events
      where event_type='QR_DETECTED' and staff_user_id=${staffA.id}
      order by created_at desc limit 1
    `;
    expect(String(storedEvent.establishment_id)).toBe(restaurantA.id);
    expect(String(storedEvent.staff_user_id)).toBe(staffA.id);
    expect(storedEvent.card_id).toBeNull();

    const creditB = await pageB.request.post("/api/credit", {
      headers: { origin },
      data: { token: tokenB, idempotencyKey: crypto.randomUUID() },
    });
    expect(creditB.ok()).toBeTruthy();
    const [transactionB] = await sql`
      select id from transactions where establishment_id=${restaurantB.id} order by created_at desc limit 1
    `;
    await expectConstraint(sql`
      insert into transactions(establishment_id,card_id,staff_user_id,type,delta,balance_after,unit,idempotency_key,reversed_transaction_id)
      values(${restaurantA.id},${dbCardA.id},${staffA.id},'reversal',0,${dbCardA.balance},'STAMP',${crypto.randomUUID()},${transactionB.id})
    `, "23503");

    const creditA = await pageA.request.post("/api/credit", {
      headers: { origin },
      data: { token: tokenA, idempotencyKey: crypto.randomUUID() },
    });
    expect(creditA.ok()).toBeTruthy();
    const historyA = await pageA.request.get("/api/history").then((response) => response.json());
    const originalA = historyA.find((entry: { type: string }) => entry.type === "earn");
    const reverseA = await pageA.request.post("/api/transactions/reverse", {
      headers: { origin },
      data: { transactionId: originalA.id, idempotencyKey: crypto.randomUUID() },
    });
    expect(reverseA.ok()).toBeTruthy();
    const [freshCardA] = await sql`select balance from cards where id=${dbCardA.id}`;
    await expectConstraint(sql`
      insert into transactions(establishment_id,card_id,staff_user_id,type,delta,balance_after,unit,idempotency_key,reversed_transaction_id)
      values(${restaurantA.id},${dbCardA.id},${staffA.id},'reversal',0,${freshCardA.balance},'STAMP',${crypto.randomUUID()},${originalA.id})
    `, "23505");
  } finally {
    await sql.end({ timeout: 5 });
    await contextA.close();
    await contextB.close();
  }
});
