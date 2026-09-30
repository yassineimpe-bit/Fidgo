import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { createMerchant, origin, unique } from "./helpers";

test.setTimeout(180_000);

type Sql = ReturnType<typeof postgres>;

function db() {
  return postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
}

async function ownerOf(page: Page) {
  const employees = await page.request.get("/api/employees").then((response) => response.json());
  const owner = employees.find((employee: { role: string }) => employee.role === "OWNER");
  expect(owner).toBeTruthy();
  const restaurant = await page.request.get("/api/restaurant").then((response) => response.json());
  return { staffId: String(owner.id), establishmentId: String(restaurant.id), slug: String(restaurant.slug), name: String(restaurant.name) };
}

/**
 * Commerces synthétiques : le ledger est append-only, donc on insère des
 * écritures datées dans le passé plutôt que d'attendre. Aucune n'est modifiée
 * ni supprimée ensuite ; chaque exécution utilise un préfixe unique. Les
 * fixtures restent cohérentes pour `db:verify` (lancé après la suite E2E) :
 * chaque commerce a un état de facturation, chaque solde égale son ledger.
 */
async function syntheticEstablishment(sql: Sql, prefix: string, label: string, createdDaysAgo: number, subscription: { status: "active" | "trial"; trialEndsInDays?: number } = { status: "active" }) {
  const [row] = await sql`
    insert into establishments(slug, name, created_at)
    values(${`${prefix}-${label}`}, ${`Cockpit ${label} ${prefix}`}, now() - ${createdDaysAgo}::int * interval '1 day')
    returning id
  `;
  await sql`insert into loyalty_programs(establishment_id) values(${row.id})`;
  await sql`
    insert into subscriptions(establishment_id, status, trial_ends_at)
    values(${row.id}, ${subscription.status}, ${subscription.trialEndsInDays === undefined ? null : sql`now() + ${subscription.trialEndsInDays}::int * interval '1 day'`})
  `;
  return { id: String(row.id), name: `Cockpit ${label} ${prefix}`, slug: `${prefix}-${label}` };
}

const privateValues: string[] = [];
const privateShortCodes: string[] = [];

async function syntheticCard(sql: Sql, establishmentId: string) {
  const email = `${unique("cockpit-client")}@example.com`;
  const token = `cockpit${crypto.randomUUID().replaceAll("-", "")}`;
  const shortCode = `QZ${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const [customer] = await sql`
    insert into customers(establishment_id, first_name, email, phone)
    values(${establishmentId}, 'Cockpitprenom', ${email}, ${`+3360${Math.floor(1_000_000 + Math.random() * 8_999_999)}`})
    returning id, phone
  `;
  const [card] = await sql`
    insert into cards(establishment_id, customer_id, token, short_code)
    values(${establishmentId}, ${customer.id}, ${token}, ${shortCode})
    returning id
  `;
  privateValues.push(email, token, String(customer.phone));
  privateShortCodes.push(shortCode);
  return String(card.id);
}

/** Écriture datée dans le passé ; le solde en cache de la carte suit le ledger. */
async function ledger(sql: Sql, establishmentId: string, cardId: string, hoursAgo: number, type: "earn" | "redeem" | "adjust" = "earn", delta = type === "redeem" ? -10 : 1) {
  const [card] = await sql`update cards set balance = balance + ${delta} where id=${cardId} returning balance`;
  await sql`
    insert into transactions(establishment_id, card_id, type, delta, balance_after, unit, idempotency_key, created_at)
    values(${establishmentId}, ${cardId}, ${type}, ${delta}, ${card.balance}, 'STAMP', ${crypto.randomUUID()}, now() - ${hoursAgo}::int * interval '1 hour')
  `;
}

async function scanEvents(sql: Sql, establishmentId: string, success: number[], failed: number) {
  for (const duration of success) {
    await sql`insert into product_events(establishment_id, event_type, duration_ms, created_at) values(${establishmentId}, 'SCAN_SUCCESS', ${duration}, now() - interval '2 hours')`;
  }
  for (let index = 0; index < failed; index += 1) {
    await sql`insert into product_events(establishment_id, event_type, created_at) values(${establishmentId}, 'SCAN_FAILED', now() - interval '3 hours')`;
  }
}

function metric(page: Page, label: string | RegExp) {
  return page.locator(".metric", { hasText: label }).first().locator("strong");
}

async function expectNoHorizontalOverflow(page: Page, label: string) {
  const layout = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    innerWidth: window.innerWidth,
  }));
  expect(layout.overflow, `${label} : débordement`).toBeLessThanOrEqual(0);
  expect(layout.innerWidth, `${label} : innerWidth`).toBe(page.viewportSize()!.width);
}

async function expectNoPrivateData(page: Page, label: string) {
  const html = await page.content();
  for (const value of privateValues) expect(html.includes(value), `${label} expose ${value}`).toBe(false);
  expect(html).not.toContain("Cockpitprenom");
  expect(html).not.toContain("wallet-ext-cockpit");
  const text = await page.locator("body").innerText();
  for (const code of privateShortCodes) expect(text.includes(code), `${label} expose le code ${code}`).toBe(false);
  expect(text).not.toMatch(/NaN|Invalid Date|undefined/);
}

test("cockpit super-admin : nouvelles surfaces invisibles pour un commerçant ordinaire", async ({ page }) => {
  await createMerchant(page, "cockpit-not-admin");
  const me = await ownerOf(page);
  for (const path of ["/admin", "/admin/establishments?watch=1", "/admin/establishments?activity=never&subscription=trial&sort=scans_30d", `/admin/establishments/${me.establishmentId}`]) {
    expect((await page.goto(path))?.status(), path).toBe(404);
  }
});

test("cockpit super-admin : activation, usage, fidélisation, santé et règles « À surveiller »", async ({ page, browser }) => {
  await createMerchant(page, "cockpit-admin");
  const admin = await ownerOf(page);
  const prefix = unique("ck").toLowerCase();
  const sql = db();

  // Commerçant réel : les chiffres de sa fiche admin doivent égaler son analytics.
  const merchantContext = await browser.newContext();
  const merchant = await merchantContext.newPage();
  await createMerchant(merchant, "cockpit-merchant");
  const real = await ownerOf(merchant);

  try {
    await sql`insert into platform_admins(staff_user_id, note) values(${admin.staffId}, 'e2e cockpit')`;

    async function enroll(firstName: string) {
      const email = `${unique("cockpit-real")}@example.com`;
      const response = await merchant.request.post("/api/enroll", { headers: { origin }, data: { slug: real.slug, firstName, email, marketingConsent: false } });
      expect(response.status()).toBe(201);
      const token = String((await response.json()).token);
      const [card] = await sql`select id, customer_id, short_code from cards where token=${token}`;
      privateValues.push(email, token);
      privateShortCodes.push(String(card.short_code));
      return { token, cardId: String(card.id), customerId: String(card.customer_id) };
    }
    const alice = await enroll("Cockpitprenom");
    const bruno = await enroll("Cockpitprenom");
    const chloe = await enroll("Cockpitprenom");
    for (const token of [alice.token, bruno.token]) {
      const credit = await merchant.request.post("/api/credit", { headers: { origin }, data: { token, idempotencyKey: crypto.randomUUID() } });
      expect(credit.ok()).toBeTruthy();
    }
    // Alice est aussi venue il y a deux jours : cliente revenue.
    await ledger(sql, real.establishmentId, alice.cardId, 48);
    // Chloé : ajustement manuel seul, jamais active.
    const adjusted = await merchant.request.post(`/api/customers/${chloe.customerId}/adjust`, {
      headers: { origin }, data: { newBalance: 2, reason: "Régularisation sans passage", idempotencyKey: crypto.randomUUID() },
    });
    expect(adjusted.ok()).toBeTruthy();

    // Jamais démarré (5 j) et trop récent pour une alerte (1 j).
    const never = await syntheticEstablishment(sql, prefix, "never", 5);
    const fresh = await syntheticEstablishment(sql, prefix, "fresh", 1);
    // Décrochage : deux passages, le dernier il y a 10 j.
    const dropped = await syntheticEstablishment(sql, prefix, "dropped", 40);
    const droppedCard = await syntheticCard(sql, dropped.id);
    await ledger(sql, dropped.id, droppedCard, 20 * 24);
    await ledger(sql, dropped.id, droppedCard, 10 * 24);
    // Récurrent, Wallet, récompenses, scanner en échec au-dessus du volume minimal.
    const busy = await syntheticEstablishment(sql, prefix, "busy", 10);
    const busyCard1 = await syntheticCard(sql, busy.id);
    const busyCard2 = await syntheticCard(sql, busy.id);
    const busyCard3 = await syntheticCard(sql, busy.id);
    await ledger(sql, busy.id, busyCard1, 48);
    await ledger(sql, busy.id, busyCard1, 1);
    await ledger(sql, busy.id, busyCard2, 5);
    await ledger(sql, busy.id, busyCard2, 4, "adjust", 10);
    await ledger(sql, busy.id, busyCard2, 3, "redeem");
    await ledger(sql, busy.id, busyCard2, 2, "adjust");
    // Récompense disponible sans passage crédité : ajustement seul.
    await ledger(sql, busy.id, busyCard3, 6, "adjust", 10);
    await sql`insert into wallet_passes(establishment_id, card_id, provider, external_id, status) values(${busy.id}, ${busyCard1}, 'APPLE', 'wallet-ext-cockpit-a', 'active')`;
    await sql`insert into wallet_passes(establishment_id, card_id, provider, external_id, status) values(${busy.id}, ${busyCard1}, 'GOOGLE', 'wallet-ext-cockpit-g', 'active')`;
    await sql`insert into wallet_passes(establishment_id, card_id, provider, external_id, status, last_error) values(${busy.id}, ${busyCard2}, 'GOOGLE', 'wallet-ext-cockpit-e', 'error', 'wallet-ext-cockpit détail')`;
    await scanEvents(sql, busy.id, [100, 200, 300, 400, 500, 600, 700, 800], 4);
    // Taux d'échec élevé mais volume trop faible (5 tentatives) : pas d'alerte.
    const quiet = await syntheticEstablishment(sql, prefix, "quiet", 1);
    const quietCard = await syntheticCard(sql, quiet.id);
    await ledger(sql, quiet.id, quietCard, 2);
    await scanEvents(sql, quiet.id, [300, 400], 3);
    // Essai qui se termine dans 3 j sans activité récente.
    const trial = await syntheticEstablishment(sql, prefix, "trial", 27, { status: "trial", trialEndsInDays: 3 });

    // ——— Vue d'ensemble ———
    await page.goto("/admin");
    for (const heading of ["Vue d’ensemble", "Activation des commerces", "Usage réel", "Fidélisation · 30 derniers jours", "Santé technique", "État des services", "Erreurs par commerce · 7 j", "Passages crédités · 30 jours", "Activité récente"]) {
      await expect(page.getByRole("heading", { name: heading, exact: true }), heading).toBeVisible();
    }
    const watch = page.getByRole("heading", { name: /^À surveiller/ }).locator("xpath=ancestor::section[1]");
    // Aperçu borné à 30 lignes, fin d'essai et scanner en tête : les autres règles sont vérifiées par la liste et les fiches.
    await expect(watch.locator("li", { has: page.getByRole("link", { name: trial.name }) })).toContainText("Essai terminé dans 3 j · aucun passage crédité sur 7 j");
    await expect(watch.locator("li", { has: page.getByRole("link", { name: busy.name }) })).toContainText("Scanner : 4 échecs sur 12 tentatives en 7 j (33 %)");
    await expect(watch.getByRole("link", { name: fresh.name })).toHaveCount(0);
    await expect(watch.getByRole("link", { name: quiet.name })).toHaveCount(0);
    await expect(watch.getByRole("link", { name: real.name })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Erreurs par commerce · 7 j" }).locator("xpath=ancestor::section[1]").getByRole("link", { name: busy.name })).toBeVisible();
    // Totaux plateforme : base partagée entre specs, on vérifie des bornes cohérentes.
    expect(Number(await metric(page, "commerces actifs 24 h").textContent())).toBeGreaterThanOrEqual(3);
    expect(Number(await metric(page, "commerces récurrents 7 j").textContent())).toBeGreaterThanOrEqual(2);
    expect(Number(await metric(page, "passes Apple actives").textContent())).toBeGreaterThanOrEqual(1);
    await expect(metric(page, "p95 scanner 7 j")).toHaveText(/^\d+ ms$/);
    await expect(metric(page, "taux d’activation")).toHaveText(/^\d+ %$/);
    await expectNoPrivateData(page, "/admin");

    // ——— Liste : filtres, sur le préfixe de ce test ———
    const listNames = async (query: string) => {
      await page.goto(`/admin/establishments?q=${encodeURIComponent(prefix)}${query}`);
      const links = page.locator("tbody tr td:first-child a");
      return (await links.allTextContents()).map((name) => name.trim()).sort();
    };
    const names = (...items: { name: string }[]) => items.map((item) => item.name).sort();
    expect(await listNames("")).toEqual(names(never, fresh, dropped, busy, quiet, trial));
    expect(await listNames("&activity=never")).toEqual(names(never, fresh, trial));
    expect(await listNames("&activity=24h")).toEqual(names(busy, quiet));
    expect(await listNames("&activity=7d")).toEqual(names(busy, quiet));
    expect(await listNames("&activity=30d")).toEqual(names(dropped, busy, quiet));
    expect(await listNames("&activity=inactive7")).toEqual(names(dropped));
    expect(await listNames("&watch=1")).toEqual(names(never, dropped, busy, trial));
    expect(await listNames("&subscription=trial")).toEqual(names(trial));
    expect(await listNames("&subscription=active")).toEqual(names(never, fresh, dropped, busy, quiet));
    expect(await listNames("&subscription=none")).toEqual([]);
    expect(await listNames("&activity=%27%20or%201%3D1--&sort=nope")).toEqual(names(never, fresh, dropped, busy, quiet, trial));
    await page.goto(`/admin/establishments?q=${encodeURIComponent(prefix)}&sort=scans_30d`);
    await expect(page.locator("tbody tr").first()).toContainText(busy.name);
    const busyRow = page.locator("tbody tr", { hasText: busy.name });
    await expect(busyRow).toContainText("Scanner");
    await expect(busyRow).toContainText("3 / 3");
    await expect(busyRow).toContainText("2 actifs");
    await expect(busyRow).toContainText("1 revenu · 50 %");
    await expect(busyRow).toContainText("Apple 1");
    await expect(busyRow).toContainText("Google 1");
    await expect(busyRow).toContainText("1 en erreur");
    await expect(busyRow).toContainText("33 % d’échec");
    await expect(busyRow).toContainText("12 tent. · p95 765 ms");
    const neverRow = page.locator("tbody tr", { hasText: never.name });
    await expect(neverRow).toContainText("Jamais démarré");
    await expect(neverRow).toContainText("— d’échec");
    await expect(neverRow).toContainText("p95 —");
    await expect(neverRow).toContainText("0 revenu · —");
    await expectNoPrivateData(page, "/admin/establishments");
    await page.goto(`/admin/establishments?q=${encodeURIComponent(prefix)}&activity=24h&subscription=trial`);
    await expect(page.getByText("Aucun commerce ne correspond à ces filtres.")).toBeVisible();

    // ——— Fiche : commerce synthétique complet ———
    await page.goto(`/admin/establishments/${busy.id}`);
    const usage = page.getByRole("heading", { name: "Usage Retiko" }).locator("xpath=ancestor::section[1]");
    await expect(usage.locator(".metric", { hasText: "passages 7 j / 30 j" }).locator("strong")).toHaveText("3 / 3");
    await expect(usage.locator(".metric", { hasText: "clients actifs 30 j" }).locator("strong")).toHaveText("2");
    await expect(usage.locator(".metric", { hasText: "clients revenus 30 j" })).toContainText("taux de retour 50 %");
    await expect(usage.locator(".metric", { hasText: "récompenses utilisées 30 j" }).locator("strong")).toHaveText("1");
    await expect(usage.locator(".metric", { hasText: "récompenses utilisées 30 j" })).toContainText("1 disponibles aujourd’hui");
    await expect(usage.locator(".metric", { hasText: "passes actives Apple / Google" }).locator("strong")).toHaveText("1 / 1");
    await expect(usage.locator(".metric", { hasText: "erreurs scanner 7 j" }).locator("strong")).toHaveText("4");
    await expect(usage.locator(".metric", { hasText: "taux d’erreur scanner 7 j" }).locator("strong")).toHaveText("33 %");
    await expect(usage.locator(".metric", { hasText: "p95 scanner 7 j" }).locator("strong")).toHaveText("765 ms");
    await expect(usage).toContainText("Scanner : 4 échecs sur 12 tentatives");
    await usage.getByText("Activité quotidienne · 30 jours").click();
    await expect(usage.locator("tbody tr")).toHaveCount(30);
    await expect(page.getByRole("button", { name: "Suspendre le commerce" })).toBeVisible();
    await expectNoPrivateData(page, "fiche busy");

    await page.goto(`/admin/establishments/${never.id}`);
    await expect(page.getByRole("heading", { name: "Usage Retiko" }).locator("xpath=ancestor::section[1]")).toContainText("Inscrit depuis 5 j · aucun passage crédité");
    await page.goto(`/admin/establishments/${dropped.id}`);
    await expect(page.getByRole("heading", { name: "Usage Retiko" }).locator("xpath=ancestor::section[1]")).toContainText("Dernier passage crédité il y a 10 j · 2 passages au total");

    // Fiche d'un commerce vide : états vides lisibles.
    await page.goto(`/admin/establishments/${fresh.id}`);
    await expect(page.locator(".metric", { hasText: "premier passage crédité" })).toContainText("jamais démarré");
    await expect(page.locator(".metric", { hasText: "taux d’erreur scanner 7 j" }).locator("strong")).toHaveText("—");
    await expect(page.locator(".metric", { hasText: "p95 scanner 7 j" }).locator("strong")).toHaveText("—");
    await expectNoPrivateData(page, "fiche vide");

    // ——— Cohérence avec l'analytics du commerçant ———
    await merchant.goto("/dashboard/analytics?period=30");
    const merchantActive = await merchant.locator(".metric", { hasText: "clients actifs" }).first().locator("strong").textContent();
    const merchantReturning = await merchant.locator(".metric", { hasText: "clients revenus ≥2 jours" }).locator("strong").textContent();
    expect(merchantActive?.trim()).toBe("2");
    expect(merchantReturning?.trim()).toBe("50 %");
    await page.goto(`/admin/establishments/${real.establishmentId}`);
    const realUsage = page.getByRole("heading", { name: "Usage Retiko" }).locator("xpath=ancestor::section[1]");
    await expect(realUsage.locator(".metric", { hasText: "clients actifs 30 j" }).locator("strong")).toHaveText(merchantActive!.trim());
    await expect(realUsage.locator(".metric", { hasText: "clients revenus 30 j" })).toContainText(`taux de retour ${merchantReturning!.trim()}`);
    await expect(realUsage.locator(".metric", { hasText: "passages 7 j / 30 j" }).locator("strong")).toHaveText("3 / 3");
    await expectNoPrivateData(page, "fiche commerçant réel");

    // ——— Mobile : aucune page du cockpit ne déborde ———
    const viewport = page.viewportSize()!;
    try {
      for (const width of [320, 390, 430]) {
        await page.setViewportSize({ width, height: 800 });
        for (const path of ["/admin", `/admin/establishments?q=${encodeURIComponent(prefix)}&watch=1`, `/admin/establishments/${busy.id}`]) {
          await page.goto(path);
          await expectNoHorizontalOverflow(page, `${path} @${width}px`);
        }
      }
    } finally {
      await page.setViewportSize(viewport);
    }

    // Chaque consultation reste journalisée, filtres compris.
    const [view] = await sql`
      select metadata from platform_admin_audit
      where admin_staff_user_id=${admin.staffId} and action='ADMIN_VIEW' and metadata->>'view'='establishments' and metadata->>'activity'='inactive7'
      limit 1
    `;
    expect(view).toBeTruthy();
  } finally {
    await sql`delete from platform_admins where staff_user_id=${admin.staffId}`;
    await sql.end({ timeout: 5 });
    await merchantContext.close();
  }
});
