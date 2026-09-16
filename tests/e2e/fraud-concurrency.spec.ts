import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { createMerchant, origin, unique } from "./helpers";

async function tokenForNewCustomer(page: Page, label: string, slug: string) {
  const response = await page.request.post("/api/enroll", {
    headers: { origin },
    data: {
      slug,
      firstName: label,
      email: `${unique(label)}@example.com`,
      marketingConsent: false,
    },
  });
  expect(response.status()).toBe(201);
  return String((await response.json()).token);
}

async function credit(page: Page, token: string, idempotencyKey = crypto.randomUUID(), extra: Record<string, unknown> = {}) {
  return page.request.post("/api/credit", {
    headers: { origin },
    data: { token, idempotencyKey, ...extra },
  });
}

async function scanBalance(page: Page, token: string) {
  const response = await page.request.post("/api/scan", { headers: { origin }, data: { token } });
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<{ balance: number; lastEarnAt: string | null }>;
}

test("fraude/concurrence : idempotence, cooldown, redemption et ledger restent cohérents", async ({ page }) => {
  test.setTimeout(90_000);
  await createMerchant(page, "fraud-concurrency");
  const restaurant = await page.request.get("/api/restaurant").then((response) => response.json());
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  const secondDevice = await page.context().browser()!.newContext({
    storageState: await page.context().storageState(),
  });
  const secondDevicePage = await secondDevice.newPage();

  try {
    const sameKeyToken = await tokenForNewCustomer(page, "same-key", restaurant.slug);
    const sameKey = crypto.randomUUID();
    const sameKeyResponses = await Promise.all([
      credit(page, sameKeyToken, sameKey),
      credit(page, sameKeyToken, sameKey),
    ]);
    expect(sameKeyResponses.every((response) => response.ok())).toBe(true);
    const sameKeyBodies = await Promise.all(sameKeyResponses.map((response) => response.json()));
    expect(sameKeyBodies.map((body) => body.duplicate).sort()).toEqual([false, true]);
    expect((await scanBalance(page, sameKeyToken)).balance).toBe(1);

    const distinctKeysToken = await tokenForNewCustomer(page, "distinct-keys", restaurant.slug);
    const distinctResponses = await Promise.all([
      credit(page, distinctKeysToken),
      credit(secondDevicePage, distinctKeysToken),
    ]);
    expect(distinctResponses.map((response) => response.status()).sort()).toEqual([200, 409]);
    expect((await scanBalance(page, distinctKeysToken)).balance).toBe(1);

    for (const amount of [0, -1, 10_000_001, "NaN", "Infinity", "pas-un-montant"]) {
      const response = await credit(page, distinctKeysToken, crypto.randomUUID(), { purchaseAmountCents: amount });
      expect(response.status(), `purchaseAmountCents=${String(amount)}`).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: "INVALID_AMOUNT" });
    }

    const redeemToken = await tokenForNewCustomer(page, "double-redeem", restaurant.slug);
    const customer = await sql`
      select u.id from customers u join cards c on c.customer_id=u.id where c.token=${redeemToken}
    `;
    const adjusted = await page.request.post(`/api/customers/${customer[0].id}/adjust`, {
      headers: { origin },
      data: { newBalance: 10, reason: "Préparation concurrence", idempotencyKey: crypto.randomUUID() },
    });
    expect(adjusted.ok()).toBeTruthy();
    const redemptions = await Promise.all([
      page.request.post("/api/redeem", { headers: { origin }, data: { token: redeemToken, idempotencyKey: crypto.randomUUID() } }),
      page.request.post("/api/redeem", { headers: { origin }, data: { token: redeemToken, idempotencyKey: crypto.randomUUID() } }),
    ]);
    expect(redemptions.map((response) => response.status()).sort()).toEqual([200, 409]);
    expect((await scanBalance(page, redeemToken)).balance).toBe(0);

    const overrideToken = await tokenForNewCustomer(page, "override-race", restaurant.slug);
    expect((await credit(page, overrideToken)).ok()).toBeTruthy();
    const observed = await scanBalance(page, overrideToken);
    const overrides = await Promise.all([
      credit(page, overrideToken, crypto.randomUUID(), { overrideReason: "Achat distinct", expectedLastEarnAt: observed.lastEarnAt }),
      credit(page, overrideToken, crypto.randomUUID(), { overrideReason: "Achat distinct", expectedLastEarnAt: observed.lastEarnAt }),
    ]);
    expect(overrides.map((response) => response.status()).sort()).toEqual([200, 409]);
    const overrideErrors = await Promise.all(overrides.filter((response) => !response.ok()).map((response) => response.json()));
    expect(overrideErrors[0]).toMatchObject({ error: "STALE_CARD_STATE" });
    expect((await scanBalance(page, overrideToken)).balance).toBe(2);

    // Avec cooldown explicitement désactivé, crédit et redemption concurrents
    // sont tous deux autorisés mais le verrou carte doit produire un solde 1.
    const program = await page.request.get("/api/program").then((response) => response.json());
    const programUpdate = await page.request.patch("/api/program", {
      headers: { origin },
      data: {
        programName: program.program_name,
        mode: "STAMPS",
        pointsRule: "PER_PURCHASE",
        rewardThreshold: 10,
        rewardLabel: program.reward_label,
        stampsPerVisit: 1,
        pointsPerPurchase: 10,
        pointsPerEuro: 1,
        dailyEarnLimit: 0,
        cooldownSeconds: 0,
        expiresAfterDays: null,
      },
    });
    expect(programUpdate.ok()).toBeTruthy();
    const mixedToken = await tokenForNewCustomer(page, "redeem-credit", restaurant.slug);
    const [mixedCustomer] = await sql`
      select u.id from customers u join cards c on c.customer_id=u.id where c.token=${mixedToken}
    `;
    expect((await page.request.post(`/api/customers/${mixedCustomer.id}/adjust`, {
      headers: { origin },
      data: { newBalance: 10, reason: "Préparation course mixte", idempotencyKey: crypto.randomUUID() },
    })).ok()).toBeTruthy();
    const mixed = await Promise.all([
      credit(page, mixedToken),
      page.request.post("/api/redeem", { headers: { origin }, data: { token: mixedToken, idempotencyKey: crypto.randomUUID() } }),
    ]);
    expect(mixed.every((response) => response.ok())).toBe(true);
    expect((await scanBalance(page, mixedToken)).balance).toBe(1);

    const reverseToken = await tokenForNewCustomer(page, "double-reverse", restaurant.slug);
    expect((await credit(page, reverseToken)).ok()).toBeTruthy();
    const [reverseCard] = await sql`select id from cards where token=${reverseToken}`;
    const [original] = await sql`
      select id from transactions where card_id=${reverseCard.id} and type='earn' order by created_at desc limit 1
    `;
    expect(original).toBeTruthy();
    const doubleReverse = await Promise.all([
      page.request.post("/api/transactions/reverse", { headers: { origin }, data: { transactionId: original.id, idempotencyKey: crypto.randomUUID() } }),
      page.request.post("/api/transactions/reverse", { headers: { origin }, data: { transactionId: original.id, idempotencyKey: crypto.randomUUID() } }),
    ]);
    expect(doubleReverse.map((response) => response.status()).sort()).toEqual([200, 409]);

    const balances = await sql`
      select c.id,c.balance,coalesce(sum(t.delta),0)::int as ledger_balance
      from cards c left join transactions t on t.card_id=c.id
      where c.token in (${sameKeyToken},${distinctKeysToken},${redeemToken},${overrideToken},${mixedToken},${reverseToken})
      group by c.id,c.balance
    `;
    expect(balances).toHaveLength(6);
    for (const row of balances) expect(Number(row.balance)).toBe(Number(row.ledger_balance));
    const [reversedCount] = await sql`
      select count(*)::int as count from transactions where card_id=${reverseCard.id} and type='reversal'
    `;
    expect(Number(reversedCount.count)).toBe(1);
  } finally {
    await sql.end({ timeout: 5 });
    await secondDevice.close();
  }
});
