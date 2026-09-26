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
