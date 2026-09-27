import { expect, test, type Browser, type Page, type Request } from "@playwright/test";
import postgres from "postgres";
import { createMerchant, currentCustomerId, enrollCustomer, origin, testClientIp, unique } from "./helpers";

// Inscription + compilation à la demande de la fiche client et de l'API d'ajustement.
test.describe.configure({ timeout: 90_000 });

const password = "Password-test-123!";

async function merchantWithCustomer(page: Page, label: string) {
  await createMerchant(page, label);
  await enrollCustomer(page, "Nora", `${unique(`${label}-client`)}@example.com`);
  await page.goto("/dashboard");
  const customerId = await currentCustomerId(page);
  return customerId;
}

function apiAdjust(page: Page, customerId: string, data: Record<string, unknown>) {
  return page.request.post(`/api/customers/${customerId}/adjust`, {
    headers: { origin },
    data: { reason: "Préparation test", idempotencyKey: crypto.randomUUID(), ...data },
  });
}

function watchAdjust(page: Page) {
  const requests: Request[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/api\/customers\/[^/]+\/adjust$/.test(new URL(request.url()).pathname)) requests.push(request);
  });
  return requests;
}

async function ledger(customerId: string) {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const rows = await sql`
      select t.delta, t.balance_after, t.metadata->>'reason' as reason
      from transactions t join cards c on c.id=t.card_id
      where c.customer_id=${customerId} and t.type='adjust' order by t.created_at`;
    const [audit] = await sql`
      select count(*)::int as n from audit_logs a join cards c on c.id::text=a.entity_id
      where c.customer_id=${customerId} and a.action='CARD_ADJUSTED'`;
    return { rows, audits: audit.n as number };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const dialog = (page: Page) => page.getByRole("dialog");

async function fillAdjustment(page: Page, variation: string, reason: string) {
  await page.getByRole("button", { name: "Ajuster manuellement le solde" }).click();
  await expect(page.getByLabel("Variation")).toBeFocused();
  await page.getByLabel("Variation").fill(variation);
  await page.getByLabel("Motif (obligatoire)").fill(reason);
}

test("OWNER : +2 avec motif, récapitulatif, Annuler et Échap sans requête, solde et historique à jour sans rechargement", async ({ page }) => {
  const customerId = await merchantWithCustomer(page, "adjust-owner");
  await page.goto(`/dashboard/clients/${customerId}`);
  const requests = watchAdjust(page);

  // Échap à la saisie : fermeture sans envoi.
  await page.getByRole("button", { name: "Ajuster manuellement le solde" }).click();
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeHidden();

  await fillAdjustment(page, "+2", "");
  const preview = page.locator("output.adjust-preview");
  await expect(preview).toContainText("Solde actuel0 tampon");
  await expect(preview).toContainText("+2 tampons (ajout)");
  await expect(preview).toContainText("Nouveau solde2 tampons");
  await page.getByRole("button", { name: "Vérifier l’ajustement" }).click();
  await expect(dialog(page).getByRole("alert")).toHaveText("Le motif est obligatoire.");

  await page.getByLabel("Motif (obligatoire)").fill("Crédit non enregistré pendant la panne réseau");
  await page.getByRole("button", { name: "Vérifier l’ajustement" }).click();
  const summary = dialog(page).locator("dl.adjust-summary");
  await expect(page.getByRole("heading", { name: "Confirmer l’ajustement ?" })).toBeFocused();
  await expect(summary).toContainText("ClientNora");
  await expect(summary).toContainText("Ancien solde0 tampon");
  await expect(summary).toContainText("Variation+2 tampons (ajout)");
  await expect(summary).toContainText("Nouveau solde2 tampons");
  await expect(summary).toContainText("MotifCrédit non enregistré pendant la panne réseau");

  await dialog(page).getByRole("button", { name: "Annuler" }).click();
  await expect(dialog(page)).toBeHidden();
  expect(requests).toHaveLength(0);

  await fillAdjustment(page, "+2", "Crédit non enregistré pendant la panne réseau");
  await page.getByRole("button", { name: "Vérifier l’ajustement" }).click();
  await dialog(page).getByRole("button", { name: "Confirmer l’ajustement" }).click();
  await expect(page.getByText("Solde ajusté. L’opération a été ajoutée à l’historique.")).toBeVisible({ timeout: 15_000 });
  expect(requests).toHaveLength(1);
  await expect(page.locator(".metric", { hasText: "solde actuel" }).locator("strong")).toHaveText("2");
  const row = page.locator("tbody tr").first();
  await expect(row).toContainText("Ajustement");
  await expect(row).toContainText("Motif : Crédit non enregistré pendant la panne réseau");
  await expect(row).toContainText("+2");

  const { rows, audits } = await ledger(customerId);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ delta: 2, balance_after: 2, reason: "Crédit non enregistré pendant la panne réseau" });
  expect(audits).toBe(1);
});

test("solde négatif et variation invalide bloqués avant confirmation", async ({ page }) => {
  const customerId = await merchantWithCustomer(page, "adjust-negative");
  await page.goto(`/dashboard/clients/${customerId}`);
  const requests = watchAdjust(page);
  await fillAdjustment(page, "-1", "Retrait");
  await expect(page.locator("output.adjust-preview")).toContainText("Négatif : impossible");
  await page.getByRole("button", { name: "Vérifier l’ajustement" }).click();
  await expect(dialog(page).getByRole("alert")).toHaveText("Le nouveau solde ne peut pas être négatif.");
  await page.getByLabel("Variation").fill("1,5");
  await page.getByRole("button", { name: "Vérifier l’ajustement" }).click();
  await expect(dialog(page).getByRole("alert")).toContainText("variation entière non nulle");
  expect(requests).toHaveLength(0);
  // Contrôle serveur inchangé.
  expect((await apiAdjust(page, customerId, { newBalance: -1 })).status()).toBe(400);
  expect((await apiAdjust(page, customerId, { newBalance: 3, reason: "" })).status()).toBe(400);
});

test("réponse perdue : message non confirmé, relance avec la même clé, une seule écriture", async ({ page }) => {
  const customerId = await merchantWithCustomer(page, "adjust-lost");
  await page.goto(`/dashboard/clients/${customerId}`);
  const requests = watchAdjust(page);
  await page.route("**/api/customers/*/adjust", async (route) => {
    await route.fetch();
    await route.abort("internetdisconnected");
  });
  await fillAdjustment(page, "+3", "Oubli en caisse");
  await page.getByRole("button", { name: "Vérifier l’ajustement" }).click();
  await dialog(page).getByRole("button", { name: "Confirmer l’ajustement" }).click();
  await expect(dialog(page).getByRole("alert")).toHaveText("L’ajustement n’a pas pu être confirmé. Réessayez pour vérifier sans risquer de dupliquer l’action.", { timeout: 15_000 });

  await page.unroute("**/api/customers/*/adjust");
  await dialog(page).getByRole("button", { name: "Réessayer" }).click();
  await expect(page.getByText("Solde ajusté. L’opération a été ajoutée à l’historique.")).toBeVisible({ timeout: 15_000 });
  expect(requests).toHaveLength(2);
  const keys = requests.map((request) => (request.postDataJSON() as { idempotencyKey: string }).idempotencyKey);
  expect(keys[0]).toBe(keys[1]);
  const { rows, audits } = await ledger(customerId);
  expect(rows).toHaveLength(1);
  expect(audits).toBe(1);
  await expect(page.locator(".metric", { hasText: "solde actuel" }).locator("strong")).toHaveText("3");
});

test("solde modifié ailleurs pendant la saisie : aucun écrasement, nouveau solde affiché", async ({ page }) => {
  const customerId = await merchantWithCustomer(page, "adjust-race");
  await page.goto(`/dashboard/clients/${customerId}`);
  await fillAdjustment(page, "+2", "Crédit oublié");
  await page.getByRole("button", { name: "Vérifier l’ajustement" }).click();

  // Un crédit arrive entre-temps (autre poste) : le solde passe à 5.
  expect((await apiAdjust(page, customerId, { newBalance: 5 })).ok()).toBeTruthy();
  await dialog(page).getByRole("button", { name: "Confirmer l’ajustement" }).click();
  await expect(dialog(page).getByRole("alert")).toContainText("Le solde a changé depuis l’ouverture de la fiche", { timeout: 15_000 });
  await expect(page.locator("output.adjust-preview")).toContainText("Solde actuel5 tampons");
  await expect(page.locator("output.adjust-preview")).toContainText("Nouveau solde7 tampons");
  const { rows } = await ledger(customerId);
  expect(rows.map((row) => row.balance_after)).toEqual([5]);
});

async function staffSession(browser: Browser, owner: Page, role: "MANAGER" | "EMPLOYEE" | "VIEWER") {
  const email = `${unique(`adjust-${role.toLowerCase()}`)}@example.com`;
  expect((await owner.request.post("/api/employees", { headers: { origin }, data: { email, password, role } })).ok()).toBeTruthy();
  const context = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": testClientIp() } });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(role === "EMPLOYEE" ? /\/s$/ : /\/dashboard$/, { timeout: 15_000 });
  return { context, page };
}

test("MANAGER retire 1 ; EMPLOYEE et VIEWER n'ont aucune action d'ajustement", async ({ page, browser }) => {
  const customerId = await merchantWithCustomer(page, "adjust-roles");
  expect((await apiAdjust(page, customerId, { newBalance: 3 })).ok()).toBeTruthy();

  const manager = await staffSession(browser, page, "MANAGER");
  try {
    await manager.page.goto(`/dashboard/clients/${customerId}`);
    await fillAdjustment(manager.page, "-1", "Tampon crédité deux fois");
    await manager.page.getByRole("button", { name: "Vérifier l’ajustement" }).click();
    await expect(dialog(manager.page).locator("dl.adjust-summary")).toContainText("Variation−1 tampon (retrait)");
    await dialog(manager.page).getByRole("button", { name: "Confirmer l’ajustement" }).click();
    await expect(manager.page.getByText("Solde ajusté. L’opération a été ajoutée à l’historique.")).toBeVisible({ timeout: 15_000 });
    await expect(manager.page.locator(".metric", { hasText: "solde actuel" }).locator("strong")).toHaveText("2");
  } finally {
    await manager.context.close();
  }

  const viewer = await staffSession(browser, page, "VIEWER");
  try {
    await viewer.page.goto(`/dashboard/clients/${customerId}`);
    await expect(viewer.page.getByText("Historique des transactions")).toBeVisible();
    await expect(viewer.page.getByRole("button", { name: "Ajuster manuellement le solde" })).toHaveCount(0);
    expect((await apiAdjust(viewer.page, customerId, { newBalance: 9 })).status()).toBe(403);
  } finally {
    await viewer.context.close();
  }

  const employee = await staffSession(browser, page, "EMPLOYEE");
  try {
    await employee.page.goto(`/dashboard/clients/${customerId}`);
    await expect(employee.page).toHaveURL(/\/s$/);
    await expect(employee.page.getByRole("button", { name: "Ajuster manuellement le solde" })).toHaveCount(0);
    expect((await apiAdjust(employee.page, customerId, { newBalance: 9 })).status()).toBe(403);
  } finally {
    await employee.context.close();
  }
});

test("cross-tenant : un autre commerce ne peut pas ajuster ce client", async ({ page, browser }) => {
  const customerId = await merchantWithCustomer(page, "adjust-tenant-a");
  const context = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": testClientIp() } });
  const other = await context.newPage();
  try {
    await createMerchant(other, "adjust-tenant-b");
    expect((await apiAdjust(other, customerId, { newBalance: 50 })).status()).toBe(404);
    await other.goto(`/dashboard/clients/${customerId}`);
    await expect(other.getByRole("button", { name: "Ajuster manuellement le solde" })).toHaveCount(0);
  } finally {
    await context.close();
  }
  const { rows } = await ledger(customerId);
  expect(rows).toHaveLength(0);
});

for (const width of [320, 390, 430]) {
  test(`ajustement utilisable à ${width} px, cibles ≥ 44 px`, async ({ page }) => {
    const customerId = await merchantWithCustomer(page, `adjust-${width}`);
    await page.setViewportSize({ width, height: 640 });
    await page.goto(`/dashboard/clients/${customerId}`);
    await fillAdjustment(page, "+1", "Oubli");
    await page.getByRole("button", { name: "Vérifier l’ajustement" }).click();
    for (const name of ["Confirmer l’ajustement", "Modifier", "Annuler"]) {
      const target = dialog(page).getByRole("button", { name });
      await target.scrollIntoViewIfNeeded();
      await expect(target).toBeVisible();
      expect((await target.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    const box = await dialog(page).boundingBox();
    expect((box?.x ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 0) <= width).toBeTruthy();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  });
}
