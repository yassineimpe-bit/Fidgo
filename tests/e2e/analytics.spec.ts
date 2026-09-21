import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { createMerchant, currentCustomerId, enrollCustomer, origin, unique } from "./helpers";

test("analytics : période sélectionnable et état vide exploitable", async ({ page }) => {
  await createMerchant(page, "analytics");
  await page.goto("/dashboard/analytics");

  await expect(page.getByRole("heading", { name: "Activité du programme" })).toBeVisible();
  await expect(page.getByText("Pas encore d’activité sur cette période.")).toBeVisible();

  await page.getByRole("link", { name: "7 jours" }).click();
  await expect(page).toHaveURL(/period=7/);
  await expect(page.getByText("nouveaux clients")).toBeVisible();
  await expect(page.getByText("p95 QR → fiche client")).toBeVisible();
});


test("dashboard : scans du jour et récompenses disponibles reflètent l'activité réelle", async ({ page }) => {
  await createMerchant(page, "dashboard-pilot-metrics");
  const enrolled = await enrollCustomer(page, "Métriques", `${unique("metrics-client")}@example.com`);
  const token = enrolled.cardUrl.split("/c/")[1];

  const customerId = await currentCustomerId(page);

  const program = await page.request.get("/api/program").then((response) => response.json());
  const adjusted = await page.request.post(`/api/customers/${customerId}/adjust`, {
    headers: { origin },
    data: {
      newBalance: Number(program.reward_threshold),
      reason: "Préparation métrique dashboard",
      idempotencyKey: crypto.randomUUID(),
    },
  });
  expect(adjusted.ok()).toBeTruthy();

  const scanEvent = await page.request.post("/api/events", {
    headers: { origin },
    data: { eventType: "SCAN_SUCCESS", durationMs: 120, source: "qr" },
  });
  expect(scanEvent.status()).toBe(202);

  await page.goto("/dashboard");
  await expect(page.locator(".metric", { hasText: "scans du jour" }).locator("strong")).toHaveText("1");
  await expect(page.locator(".metric", { hasText: "récompenses disponibles" }).locator("strong")).toHaveText("1");

  const scanned = await page.request.post("/api/scan", {
    headers: { origin },
    data: { token },
  });
  expect(scanned.ok()).toBeTruthy();
  await expect(scanned.json()).resolves.toMatchObject({ rewardAvailable: true });
});


test("analytics avancées : horaire, rétention, récompenses, cohortes et RFM reposent sur le ledger réel", async ({ page }) => {
  test.setTimeout(90_000);
  await createMerchant(page, "advanced-analytics");

  const program = await page.request.get("/api/program").then((response) => response.json());
  const programUpdate = await page.request.patch("/api/program", {
    headers: { origin },
    data: {
      programName: program.program_name,
      mode: "STAMPS",
      pointsRule: "PER_PURCHASE",
      rewardThreshold: 3,
      rewardLabel: "Récompense analytics",
      stampsPerVisit: 1,
      pointsPerPurchase: 10,
      pointsPerEuro: 1,
      dailyEarnLimit: 0,
      cooldownSeconds: 0,
      expiresAfterDays: null,
    },
  });
  expect(programUpdate.ok()).toBeTruthy();

  const active = await enrollCustomer(page, "Active Analytics", `${unique("analytics-active")}@example.com`);
  const token = active.cardUrl.split("/c/")[1];
  const restaurant = await page.request.get("/api/restaurant").then((response) => response.json());

  const dormant45 = await page.request.post("/api/enroll", {
    headers: { origin },
    data: { slug: restaurant.slug, firstName: "Dormant 45", email: `${unique("dormant45")}@example.com`, marketingConsent: false },
  });
  expect(dormant45.status()).toBe(201);
  const dormant45Token = String((await dormant45.json()).token);

  const dormant100 = await page.request.post("/api/enroll", {
    headers: { origin },
    data: { slug: restaurant.slug, firstName: "Dormant 100", email: `${unique("dormant100")}@example.com`, marketingConsent: false },
  });
  expect(dormant100.status()).toBe(201);
  const dormant100Token = String((await dormant100.json()).token);

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const [owner] = await sql`
      select id,establishment_id from staff_users
      where establishment_id=${restaurant.id} and role='OWNER'
      limit 1
    `;
    const [card] = await sql`select id,customer_id from cards where token=${token} limit 1`;
    const [card45] = await sql`select id,customer_id from cards where token=${dormant45Token} limit 1`;
    const [card100] = await sql`select id,customer_id from cards where token=${dormant100Token} limit 1`;

    await sql`update customers set created_at=now()-interval '45 days' where id=${card45.customer_id}`;
    await sql`update cards set created_at=now()-interval '45 days' where id=${card45.id}`;
    await sql`update customers set created_at=now()-interval '100 days' where id=${card100.customer_id}`;
    await sql`update cards set created_at=now()-interval '100 days' where id=${card100.id}`;

    const localDay = `date_trunc('day', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris'`;
    const txs = [
      { type: "earn", delta: 1, balance: 1, when: `(${localDay}) - interval '10 days' + interval '9 hours'`, amount: 1000 },
      { type: "earn", delta: 1, balance: 2, when: `(${localDay}) - interval '8 days' + interval '14 hours'`, amount: 1200 },
      { type: "earn", delta: 1, balance: 3, when: `(${localDay}) - interval '6 days' + interval '18 hours'`, amount: 900 },
      { type: "redeem", delta: -3, balance: 0, when: `(${localDay}) - interval '6 days' + interval '18 hours 5 minutes'`, amount: null },
      { type: "earn", delta: 1, balance: 1, when: `(${localDay}) - interval '1 day' + interval '11 hours'`, amount: 1500 },
    ] as const;

    for (const [index, tx] of txs.entries()) {
      const metadata = tx.amount === null ? {} : { purchaseAmountCents: tx.amount };
      await sql.unsafe(
        `insert into transactions(establishment_id,card_id,staff_user_id,type,delta,balance_after,unit,idempotency_key,metadata,created_at)
         values($1,$2,$3,$4,$5,$6,'STAMP',$7,$8::jsonb,${tx.when})`,
        [restaurant.id, card.id, owner.id, tx.type, tx.delta, tx.balance, `analytics-${index}-${crypto.randomUUID()}`, JSON.stringify(metadata)],
      );
    }
    await sql`
      update cards
      set balance=1,last_earn_at=now()-interval '1 day',updated_at=now()
      where id=${card.id}
    `;
  } finally {
    await sql.end({ timeout: 5 });
  }

  await page.goto("/dashboard/analytics?period=30");

  await expect(page.locator(".metric", { hasText: "délai moyen entre visites" }).locator("strong")).not.toHaveText("0 h");
  await expect(page.locator(".metric", { hasText: "visites moyennes avant récompense" }).locator("strong")).toHaveText("3.0");
  await expect(page.locator(".metric", { hasText: "taux d’utilisation des récompenses" }).locator("strong")).toHaveText("100 %");
  await expect(page.locator(".metric", { hasText: "clients inactifs 30–89 j" }).locator("strong")).toHaveText("1");
  await expect(page.locator(".metric", { hasText: "clients perdus ≥90 j" }).locator("strong")).toHaveText("1");

  const hourlyTable = page.getByRole("heading", { name: "Fréquentation par heure" }).locator("..");
  await expect(hourlyTable).toContainText("09h");
  await expect(hourlyTable).toContainText("14h");
  await expect(hourlyTable).toContainText("18h");

  await expect(page.getByRole("heading", { name: "Cohortes" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Segmentation RFM" })).toBeVisible();
  await expect(page.getByText(/Champions|Fidèles|À réactiver|Nouveaux|À développer/).first()).toBeVisible();
});
