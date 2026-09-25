import { expect, test, type Browser, type Page } from "@playwright/test";
import postgres from "postgres";
import { createMerchant, enrollCustomer, openCardInScanner, origin, testClientIp, unique } from "./helpers";

const password = "Password-test-123!";

async function enrollToken(page: Page, label: string) {
  const joinPath = await page.locator("code").filter({ hasText: "/j/" }).textContent();
  const response = await page.request.post("/api/enroll", {
    headers: { origin, "x-real-ip": testClientIp() },
    data: { slug: joinPath!.replace(/^\/j\//, ""), firstName: label, email: `${unique(label)}@example.com` },
  });
  expect(response.status()).toBe(201);
  return String((await response.json()).token);
}

async function staffSession(browser: Browser, page: Page, role: "EMPLOYEE" | "MANAGER") {
  const email = `${unique(`cooldown-${role.toLowerCase()}`)}@example.com`;
  expect((await page.request.post("/api/employees", { headers: { origin }, data: { email, password, role } })).ok()).toBeTruthy();
  // IP logique propre : le quota login (10/15 min par IP) est partagé par la suite.
  const context = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": testClientIp() } });
  const staffPage = await context.newPage();
  await staffPage.goto("/login");
  await staffPage.getByLabel("Email").fill(email);
  await staffPage.getByLabel("Mot de passe").fill(password);
  await staffPage.getByRole("button", { name: "Se connecter" }).click();
  await expect(staffPage).toHaveURL(role === "EMPLOYEE" ? /\/s$/ : /\/dashboard$/);
  return { context, page: staffPage };
}

function credit(page: Page, token: string, extra: Record<string, unknown> = {}) {
  return page.request.post("/api/credit", { headers: { origin }, data: { token, idempotencyKey: crypto.randomUUID(), ...extra } });
}

async function scan(page: Page, token: string) {
  const response = await page.request.post("/api/scan", { headers: { origin }, data: { token } });
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<{ shortCode: string; balance: number; lastEarnAt: string | null; canOverrideCooldown: boolean; cooldownSeconds: number; cooldownRemainingSeconds: number }>;
}

test("nouveau programme : 10 min par défaut, préréglages et valeur personnalisée conservée", async ({ page }) => {
  await createMerchant(page, "cooldown-default");
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const slug = (await page.locator("code").filter({ hasText: "/j/" }).textContent())!.replace(/^\/j\//, "");
    const programCooldown = async () => Number((await sql`
      select p.cooldown_seconds from loyalty_programs p join establishments e on e.id=p.establishment_id where e.slug=${slug}
    `)[0].cooldown_seconds);
    expect(await programCooldown()).toBe(600);

    await page.goto("/dashboard/program");
    const preset = page.getByLabel("Délai entre deux crédits");
    await expect(preset).toHaveValue("600");
    await expect(page.getByText("Soit 10 min.")).toBeVisible();

    await preset.selectOption("300");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText("Programme enregistré.")).toBeVisible();
    expect(await programCooldown()).toBe(300);

    await preset.selectOption("custom");
    await page.getByLabel("Délai personnalisé (secondes)").fill("90");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText("Programme enregistré.")).toBeVisible();
    expect(await programCooldown()).toBe(90);

    // Une valeur hors préréglage se rouvre telle quelle, sans arrondi silencieux.
    await page.reload();
    await expect(page.getByLabel("Délai entre deux crédits")).toHaveValue("custom");
    await expect(page.getByLabel("Délai personnalisé (secondes)")).toHaveValue("90");
    await expect(page.getByText("Soit 1 min 30 s.")).toBeVisible();
  } finally {
    await sql.end({ timeout: 5 });
  }
});

test("OWNER : crédit récent détecté, nouvel achat confirmé puis audité", async ({ page }) => {
  await createMerchant(page, "cooldown-owner");
  const { shortCode } = await enrollCustomer(page, "Nora", `${unique("cooldown-owner-client")}@example.com`);

  await openCardInScanner(page, shortCode);
  await page.getByRole("button", { name: "+1 tampon" }).click();
  await expect(page.getByText("+1 validé")).toBeVisible();
  await page.waitForTimeout(1_400);

  await openCardInScanner(page, shortCode);
  await expect(page.getByText("Crédit récent détecté")).toBeVisible();
  await expect(page.getByText(/Temps restant : (9|10) min \d{2} s/)).toBeVisible();

  // Refuser la confirmation n'envoie rien.
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toBe("Confirmer qu’il s’agit d’un nouvel achat effectué par le client ?");
    await dialog.dismiss();
  });
  await page.getByRole("button", { name: "Nouvel achat : autoriser un nouveau crédit" }).click();
  await expect(page.getByText(/1 \/ 10 tampons/)).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Nouvel achat : autoriser un nouveau crédit" }).click();
  await expect(page.getByText("+1 validé")).toBeVisible();

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const rows = await sql`
      select t.metadata->>'overrideReason' as override_reason, c.balance
      from transactions t join cards c on c.id=t.card_id
      where c.short_code=${shortCode} and t.type='earn'
      order by t.created_at
    `;
    expect(rows.map((row) => row.override_reason)).toEqual([null, "NEW_PURCHASE_CONFIRMED"]);
    expect(Number(rows[0].balance)).toBe(2);
    const audits = await sql`
      select a.metadata from audit_logs a join cards c on a.entity_id=c.id::text
      where c.short_code=${shortCode} and a.action='CARD_ADJUSTED'
    `;
    expect(audits).toHaveLength(1);
    expect(audits[0].metadata).toMatchObject({ reason: "NEW_PURCHASE_CONFIRMED", source: "cooldown_override", delta: 1, oldBalance: 1, newBalance: 2 });
  } finally {
    await sql.end({ timeout: 5 });
  }
});

test("EMPLOYEE : délai visible, aucun nouvel achat possible sans responsable", async ({ page, browser }) => {
  await createMerchant(page, "cooldown-employee");
  const token = await enrollToken(page, "Employe");
  expect((await credit(page, token)).ok()).toBeTruthy();
  const { shortCode } = await scan(page, token);

  const employee = await staffSession(browser, page, "EMPLOYEE");
  try {
    const seen = await scan(employee.page, token);
    expect(seen.canOverrideCooldown).toBe(false);
    expect(seen.cooldownRemainingSeconds).toBeGreaterThan(500);

    await openCardInScanner(employee.page, shortCode);
    await expect(employee.page.getByText("Crédit récent détecté")).toBeVisible();
    await expect(employee.page.getByText("Pour un nouvel achat pendant ce délai, appelle un responsable.")).toBeVisible();
    await expect(employee.page.getByRole("button", { name: /Nouvel achat/ })).toHaveCount(0);

    const forbidden = await credit(employee.page, token, { overrideReason: "NEW_PURCHASE_CONFIRMED", expectedLastEarnAt: seen.lastEarnAt });
    expect(forbidden.status()).toBe(403);
    const blocked = await credit(employee.page, token);
    expect(blocked.status()).toBe(409);
    expect(await blocked.json()).toMatchObject({ error: "COOLDOWN" });
    expect((await scan(page, token)).balance).toBe(1);
  } finally {
    await employee.context.close();
  }
});

test("MANAGER : nouvel achat autorisé, état périmé refusé, overrides concurrents sans double crédit", async ({ page, browser }) => {
  await createMerchant(page, "cooldown-manager");
  const token = await enrollToken(page, "Manager");
  expect((await credit(page, token)).ok()).toBeTruthy();

  const manager = await staffSession(browser, page, "MANAGER");
  try {
    const seen = await scan(manager.page, token);
    expect(seen.canOverrideCooldown).toBe(true);
    expect(seen.cooldownSeconds).toBe(600);

    const stale = await credit(manager.page, token, { overrideReason: "NEW_PURCHASE_CONFIRMED", expectedLastEarnAt: null });
    expect(stale.status()).toBe(409);
    expect(await stale.json()).toMatchObject({ error: "STALE_CARD_STATE" });

    const confirmed = await credit(manager.page, token, { overrideReason: "NEW_PURCHASE_CONFIRMED", expectedLastEarnAt: seen.lastEarnAt });
    expect(confirmed.status()).toBe(200);
    expect(await confirmed.json()).toMatchObject({ balance: 2, delta: 1 });

    // Deux confirmations simultanées depuis le même état : une seule passe.
    const current = await scan(manager.page, token);
    const racing = await Promise.all([
      credit(manager.page, token, { overrideReason: "NEW_PURCHASE_CONFIRMED", expectedLastEarnAt: current.lastEarnAt }),
      credit(page, token, { overrideReason: "NEW_PURCHASE_CONFIRMED", expectedLastEarnAt: current.lastEarnAt }),
    ]);
    expect(racing.map((response) => response.status()).sort()).toEqual([200, 409]);
    expect((await scan(page, token)).balance).toBe(3);

    const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
    try {
      const [card] = await sql`select id, balance from cards where token=${token.replace(/^LOY1:/, "")}`;
      const [ledger] = await sql`
        select count(*) filter (where metadata->>'overrideReason'='NEW_PURCHASE_CONFIRMED')::int as overrides,
          count(*)::int as earns
        from transactions where card_id=${card.id} and type='earn'
      `;
      const [audits] = await sql`
        select count(*)::int as count from audit_logs where entity_id=${String(card.id)} and action='CARD_ADJUSTED'
      `;
      expect({ ...ledger, balance: Number(card.balance), audits: audits.count }).toEqual({ overrides: 2, earns: 3, balance: 3, audits: 2 });
    } finally {
      await sql.end({ timeout: 5 });
    }
  } finally {
    await manager.context.close();
  }
});
