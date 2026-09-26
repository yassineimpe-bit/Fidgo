import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { createMerchant, origin, testClientIp, unique } from "./helpers";

async function enroll(page: Page, slug: string, firstName: string, marketingConsent: boolean) {
  const response = await page.request.post("/api/enroll", {
    headers: { origin, "x-real-ip": testClientIp() },
    data: { slug, firstName, email: `${unique(firstName.toLowerCase())}@example.com`, marketingConsent },
  });
  expect(response.status()).toBe(201);
  return String((await response.json()).token);
}

async function credit(page: Page, token: string, idempotencyKey = crypto.randomUUID()) {
  const response = await page.request.post("/api/credit", { headers: { origin }, data: { token, idempotencyKey } });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function redeem(page: Page, token: string) {
  const response = await page.request.post("/api/redeem", {
    headers: { origin },
    data: { token, idempotencyKey: crypto.randomUUID() },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function notifications(sql: postgres.Sql, token: string) {
  return sql`
    select n.status, n.error from reward_notifications n join cards c on c.id=n.card_id
    where c.token=${token} order by n.created_at
  `;
}

test("récompense disponible : e-mail au franchissement du seuil, une fois, seulement si activé et consenti", async ({ page }) => {
  test.setTimeout(120_000);
  await createMerchant(page, "reward-notification");
  const program = await page.request.get("/api/program").then((response) => response.json());
  const base = {
    programName: program.program_name, mode: "STAMPS", pointsRule: "PER_PURCHASE", rewardThreshold: 2,
    rewardLabel: "Un café offert", stampsPerVisit: 1, pointsPerPurchase: 1, pointsPerEuro: 1,
    dailyEarnLimit: 0, cooldownSeconds: 0, expiresAfterDays: null,
  };
  expect((await page.request.patch("/api/program", { headers: { origin }, data: base })).ok()).toBeTruthy();
  const slug = String((await page.request.get("/api/restaurant").then((response) => response.json())).slug);
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    // Option désactivée par défaut, activée depuis la page Programme.
    expect(program.reward_email_enabled).toBe(false);
    await page.goto("/dashboard/program");
    await page.getByRole("checkbox", { name: /Prévenir le client par e-mail/ }).check();
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText("Programme enregistré.")).toBeVisible({ timeout: 15_000 });
    expect((await page.request.get("/api/program").then((response) => response.json())).reward_email_enabled).toBe(true);
    expect((await page.request.patch("/api/program", { headers: { origin }, data: { ...base, rewardEmailEnabled: "yes" } })).status()).toBe(400);

    const hugo = await enroll(page, slug, "Hugo", true);
    const ines = await enroll(page, slug, "Ines", false);

    // 1/2 : pas de franchissement. 2/2 : franchissement, une notification envoyée.
    await credit(page, hugo);
    const key = crypto.randomUUID();
    expect(await credit(page, hugo, key)).toMatchObject({ balance: 2, rewardAvailable: true, duplicate: false });
    await expect.poll(async () => (await notifications(sql, hugo)).map((row) => row.status), { timeout: 10_000 }).toEqual(["sent"]);
    // Rejeu du même crédit et crédit au-delà du seuil : rien de plus.
    expect(await credit(page, hugo, key)).toMatchObject({ duplicate: true });
    await credit(page, hugo);

    // Sans consentement : aucune notification.
    await credit(page, ines);
    expect(await credit(page, ines)).toMatchObject({ rewardAvailable: true });

    // Option désactivée : aucune notification.
    expect((await page.request.patch("/api/program", { headers: { origin }, data: { ...base, rewardEmailEnabled: false } })).ok()).toBeTruthy();
    const julie = await enroll(page, slug, "Julie", true);
    await credit(page, julie);
    expect(await credit(page, julie)).toMatchObject({ rewardAvailable: true });

    // Les envois éventuels se font après la réponse : laisser le temps de les voir.
    await page.waitForTimeout(2_000);
    expect((await notifications(sql, hugo)).map((row) => row.status)).toEqual(["sent"]);
    expect(await notifications(sql, ines)).toHaveLength(0);
    expect(await notifications(sql, julie)).toHaveLength(0);
  } finally {
    await sql.end({ timeout: 5 });
  }
});

test("deux franchissements concurrents réservent une seule fenêtre de 24 h par carte", async ({ page }) => {
  test.setTimeout(120_000);
  await createMerchant(page, "reward-notification-race");
  const program = await page.request.get("/api/program").then((response) => response.json());
  const base = {
    programName: program.program_name, mode: "STAMPS", pointsRule: "PER_PURCHASE", rewardThreshold: 2,
    rewardLabel: "Un café offert", stampsPerVisit: 1, pointsPerPurchase: 1, pointsPerEuro: 1,
    dailyEarnLimit: 0, cooldownSeconds: 0, expiresAfterDays: null, rewardEmailEnabled: false,
  };
  expect((await page.request.patch("/api/program", { headers: { origin }, data: base })).ok()).toBeTruthy();
  const slug = String((await page.request.get("/api/restaurant").then((response) => response.json())).slug);
  const sql = postgres(process.env.DATABASE_URL!, { max: 3, prepare: false });

  try {
    const alice = await enroll(page, slug, "Alice", true);
    const bob = await enroll(page, slug, "Bob", true);

    // Deux franchissements distincts existent pour Alice. L'option reste
    // désactivée pendant leur création afin que les callbacks HTTP ne puissent
    // réserver à la place des appels concurrents contrôlés ci-dessous.
    await credit(page, alice);
    await credit(page, alice);
    await redeem(page, alice);
    await credit(page, alice);
    await credit(page, alice);
    await credit(page, bob);
    await credit(page, bob);
    await page.waitForTimeout(1_000);

    const [card] = await sql`
      select c.id, c.establishment_id
      from cards c where c.token=${alice}
    `;
    const aliceCrossings = await sql`
      select t.id from transactions t
      where t.card_id=${card.id} and t.type='earn' and t.balance_after=2
      order by t.created_at, t.id
    `;
    const [bobCrossing] = await sql`
      select t.id from transactions t join cards c on c.id=t.card_id
      where c.token=${bob} and t.type='earn' and t.balance_after=2
    `;
    expect(aliceCrossings).toHaveLength(2);
    expect(bobCrossing).toBeTruthy();
    expect(await notifications(sql, alice)).toHaveLength(0);

    await sql`update loyalty_programs set reward_email_enabled=true where establishment_id=${card.establishment_id}`;
    process.env.AUTH_SECRET ||= "fidgo-playwright-secret-at-least-32-characters";
    process.env.NEXT_PUBLIC_APP_URL ||= origin;
    process.env.RESEND_API_KEY ||= "re_test_dummy_key";
    process.env.EMAIL_FROM ||= "Fidgo <cards@fidgo.test>";
    process.env.EMAIL_REPLY_TO ||= "support@fidgo.test";
    process.env.CAMPAIGN_EMAIL_TEST_MODE = "true";
    const { notifyRewardAvailable } = await import("../../lib/reward-notification");

    await Promise.all(aliceCrossings.map((row) => notifyRewardAvailable(String(card.establishment_id), String(row.id))));
    expect((await notifications(sql, alice)).map((row) => row.status)).toEqual(["sent"]);

    // Un échec prestataire conserve la réservation. Le rejeu reprend la même
    // ligne (et donc la même clé d'idempotence dérivée de la transaction).
    const [aliceNotification] = await sql`select id, transaction_id from reward_notifications where card_id=${card.id}`;
    await sql`update reward_notifications set status='failed', error='EMAIL_SEND_503', sent_at=null where id=${aliceNotification.id}`;
    await notifyRewardAvailable(String(card.establishment_id), String(aliceNotification.transaction_id));
    const [retried] = await sql`select id, status, error from reward_notifications where card_id=${card.id}`;
    expect(retried).toMatchObject({ id: aliceNotification.id, status: "sent", error: null });

    // Un identifiant de tenant étranger ne peut pas réserver l'envoi.
    await notifyRewardAvailable(crypto.randomUUID(), String(bobCrossing.id));
    expect(await notifications(sql, bob)).toHaveLength(0);

    // Le verrou est par carte : une autre carte du même commerce dispose de sa
    // propre fenêtre et peut envoyer indépendamment.
    await notifyRewardAvailable(String(card.establishment_id), String(bobCrossing.id));
    expect((await notifications(sql, bob)).map((row) => row.status)).toEqual(["sent"]);

    // Une nouvelle réservation devient possible une fois les 24 h écoulées.
    await sql`update reward_notifications set created_at=now() - interval '25 hours' where card_id=${card.id}`;
    const unclaimedCrossing = aliceCrossings.find((row) => String(row.id) !== String(aliceNotification.transaction_id));
    expect(unclaimedCrossing).toBeTruthy();
    await notifyRewardAvailable(String(card.establishment_id), String(unclaimedCrossing!.id));
    expect((await notifications(sql, alice)).map((row) => row.status)).toEqual(["sent", "sent"]);
  } finally {
    await sql.end({ timeout: 5 });
  }
});
