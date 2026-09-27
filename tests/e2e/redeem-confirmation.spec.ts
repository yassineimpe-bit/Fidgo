import { expect, test, type Browser, type Page, type Request } from "@playwright/test";
import postgres from "postgres";
import { createMerchant, enrollCustomer, openCardInScanner, origin, testClientIp, unique } from "./helpers";

// Inscription + premières compilations à la demande du serveur de dev (lookup, scan, redeem).
test.describe.configure({ timeout: 90_000 });

const password = "Password-test-123!";

/** Solde de départ posé par l'ajustement manuel existant (OWNER), sans passer par le scanner. */
async function setBalance(page: Page, shortCode: string, balance: number) {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const [card] = await sql`select customer_id from cards where short_code=${shortCode} order by created_at desc limit 1`;
    const response = await page.request.post(`/api/customers/${card.customer_id}/adjust`, {
      headers: { origin },
      data: { newBalance: balance, reason: "Préparation test récompense", idempotencyKey: crypto.randomUUID() },
    });
    expect(response.ok()).toBeTruthy();
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function merchantWithReward(page: Page, label: string, balance: number) {
  await createMerchant(page, label);
  const { shortCode } = await enrollCustomer(page, "Nora", `${unique(`${label}-client`)}@example.com`);
  await page.goto("/dashboard");
  await setBalance(page, shortCode, balance);
  return shortCode;
}

function watchRedeem(page: Page) {
  const requests: Request[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/redeem") requests.push(request);
  });
  return requests;
}

const confirmation = (page: Page) => page.getByRole("group", { name: "Utiliser la récompense ?" });

test("redeem : confirmation avec coût et soldes, Échap et Annuler sans requête, double clic neutralisé", async ({ page }) => {
  const shortCode = await merchantWithReward(page, "redeem-confirm", 12);
  const redeems = watchRedeem(page);
  await openCardInScanner(page, shortCode);

  const open = page.getByRole("button", { name: "Utiliser la récompense" });
  await open.click();
  const panel = confirmation(page);
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Coût : 10 tampons");
  await expect(panel.locator("div", { hasText: "Solde actuel" }).locator("dd")).toHaveText("12 tampons");
  await expect(panel.locator("div", { hasText: "Après utilisation" }).locator("dd")).toHaveText("2 tampons");
  // Pas de crédit possible tant que la confirmation est ouverte.
  await expect(page.getByRole("button", { name: "+1 tampon" })).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(open).toBeFocused();
  await open.click();
  await confirmation(page).getByRole("button", { name: "Annuler" }).click();
  await expect(confirmation(page)).toHaveCount(0);
  expect(redeems).toHaveLength(0);

  await open.click();
  await confirmation(page).getByRole("button", { name: "Confirmer l’utilisation" }).dblclick();
  const success = page.locator(".scan-feedback[data-tone=reward]");
  await expect(success).toContainText("Récompense utilisée", { timeout: 15_000 });
  await expect(success).toContainText("−10 tampons");
  await expect(success).toContainText("Nouveau solde : 2 tampons");
  expect(redeems).toHaveLength(1);
  // Une action par scan : plus aucun bouton, retour caméra.
  await expect(page.getByRole("button", { name: /Utiliser la récompense|Confirmer/ })).toHaveCount(0);
  await expect(page.getByPlaceholder("Code court ou email")).toBeVisible({ timeout: 4_000 });

  await openCardInScanner(page, shortCode);
  await expect(page.getByText("2 / 10 tampons")).toBeVisible();
  await expect(page.getByRole("button", { name: "Utiliser la récompense" })).toBeDisabled();
});

test("redeem : deux récompenses possibles, la seconde exige un nouveau scan", async ({ page }) => {
  const shortCode = await merchantWithReward(page, "redeem-twice", 25);
  await openCardInScanner(page, shortCode);
  await page.getByRole("button", { name: "Utiliser la récompense" }).click();
  await confirmation(page).getByRole("button", { name: "Confirmer l’utilisation" }).click();
  await expect(page.getByText("Récompense utilisée")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Utiliser la récompense" })).toHaveCount(0);
  await page.getByRole("button", { name: "Scanner le client suivant" }).click();

  await openCardInScanner(page, shortCode);
  await expect(page.getByText("15 / 10 tampons")).toBeVisible();
  await expect(page.getByRole("button", { name: "Utiliser la récompense" })).toBeEnabled();
});

test("redeem : hors ligne avant l'action, rien n'est envoyé ni consommé", async ({ page, context }) => {
  const shortCode = await merchantWithReward(page, "redeem-offline", 10);
  const redeems = watchRedeem(page);
  await openCardInScanner(page, shortCode);
  await page.getByRole("button", { name: "Utiliser la récompense" }).click();

  await context.setOffline(true);
  const confirm = confirmation(page).getByRole("button", { name: "Confirmer l’utilisation" });
  await expect(confirm).toBeDisabled();
  await expect(page.getByText("Hors ligne").first()).toBeVisible();
  expect(redeems).toHaveLength(0);

  await context.setOffline(false);
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.getByText("Récompense utilisée")).toBeVisible({ timeout: 15_000 });
  expect(redeems).toHaveLength(1);
});

test("redeem : réponse perdue, état non confirmé puis relance avec la même opération", async ({ page }) => {
  const shortCode = await merchantWithReward(page, "redeem-lost", 12);
  const redeems = watchRedeem(page);
  await openCardInScanner(page, shortCode);

  // La requête atteint le serveur (débit réel), mais la réponse est perdue.
  await page.route("**/api/redeem", async (route) => {
    await route.fetch();
    await route.abort("internetdisconnected");
  });
  await page.getByRole("button", { name: "Utiliser la récompense" }).click();
  await confirmation(page).getByRole("button", { name: "Confirmer l’utilisation" }).click();
  const failure = page.locator(".scan-feedback[data-tone=network]");
  await expect(failure).toContainText("Non confirmé", { timeout: 15_000 });
  await expect(failure.locator(".scan-error[role=alert]")).toContainText("l’utilisation de la récompense n’a pas été confirmée");
  await expect(failure).not.toContainText("crédit");
  await expect(page.getByText("Récompense utilisée")).toHaveCount(0);

  await page.unroute("**/api/redeem");
  await confirmation(page).getByRole("button", { name: "Réessayer sans doublon" }).click();
  await expect(page.getByText("Récompense utilisée")).toBeVisible({ timeout: 15_000 });
  expect(redeems).toHaveLength(2);
  const keys = redeems.map((request) => (request.postDataJSON() as { idempotencyKey: string }).idempotencyKey);
  expect(keys[0]).toBe(keys[1]);

  // Un seul débit malgré la relance.
  await page.getByRole("button", { name: "Scanner le client suivant" }).click();
  await openCardInScanner(page, shortCode);
  await expect(page.getByText("2 / 10 tampons")).toBeVisible();
});

test("redeem : solde consommé ailleurs pendant la confirmation, refus clair sans succès", async ({ page }) => {
  const shortCode = await merchantWithReward(page, "redeem-race", 10);
  await openCardInScanner(page, shortCode);
  await page.getByRole("button", { name: "Utiliser la récompense" }).click();
  await expect(confirmation(page)).toContainText("Après utilisation");

  // Entre-temps, un autre poste a fait baisser le solde.
  await setBalance(page, shortCode, 3);
  await confirmation(page).getByRole("button", { name: "Confirmer l’utilisation" }).click();
  const refused = page.locator(".scan-feedback[data-tone=refused]");
  await expect(refused).toContainText("Récompense indisponible", { timeout: 15_000 });
  await expect(refused).toContainText("Le solde a changé. Cette récompense n’est plus disponible.");
  await expect(page.getByText("Récompense utilisée")).toHaveCount(0);
  await expect(confirmation(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Utiliser la récompense" })).toBeDisabled();
});

test("redeem : le délai anti double-crédit ne bloque pas la récompense", async ({ page }) => {
  const shortCode = await merchantWithReward(page, "redeem-cooldown", 10);
  await openCardInScanner(page, shortCode);
  await page.getByRole("button", { name: "+1 tampon" }).click();
  await expect(page.getByText("+1 validé")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Scanner le client suivant" }).click();

  await openCardInScanner(page, shortCode);
  await page.getByRole("button", { name: "+1 tampon" }).click();
  await expect(page.getByText("Crédit récent détecté").first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Utiliser la récompense" }).click();
  await expect(confirmation(page)).toContainText("Solde actuel");
  await confirmation(page).getByRole("button", { name: "Confirmer l’utilisation" }).click();
  await expect(page.getByText("Récompense utilisée")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Nouveau solde : 1 tampon")).toBeVisible();
});

async function employeeSession(browser: Browser, page: Page) {
  const email = `${unique("redeem-employee")}@example.com`;
  expect((await page.request.post("/api/employees", { headers: { origin }, data: { email, password, role: "EMPLOYEE" } })).ok()).toBeTruthy();
  const context = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": testClientIp() } });
  const staffPage = await context.newPage();
  await staffPage.goto("/login");
  await staffPage.getByLabel("Email").fill(email);
  await staffPage.getByLabel("Mot de passe").fill(password);
  await staffPage.getByRole("button", { name: "Se connecter" }).click();
  await expect(staffPage).toHaveURL(/\/s$/, { timeout: 15_000 });
  return { context, page: staffPage };
}

test("redeem : un EMPLOYEE confirme l'utilisation comme OWNER et MANAGER", async ({ page, browser }) => {
  const shortCode = await merchantWithReward(page, "redeem-employee", 10);
  const employee = await employeeSession(browser, page);
  try {
    await openCardInScanner(employee.page, shortCode);
    await employee.page.getByRole("button", { name: "Utiliser la récompense" }).click();
    await expect(confirmation(employee.page)).toContainText("Coût : 10 tampons");
    await confirmation(employee.page).getByRole("button", { name: "Confirmer l’utilisation" }).click();
    await expect(employee.page.getByText("Récompense utilisée")).toBeVisible({ timeout: 15_000 });
  } finally {
    await employee.context.close();
  }
});

for (const width of [320, 390, 430]) {
  test(`redeem : confirmation lisible à ${width} px, cibles ≥ 44 px`, async ({ page }) => {
    const shortCode = await merchantWithReward(page, `redeem-${width}`, 10);
    await page.setViewportSize({ width, height: 640 });
    await openCardInScanner(page, shortCode);
    await page.getByRole("button", { name: "Utiliser la récompense" }).click();
    const panel = confirmation(page);
    for (const target of [panel.getByRole("button", { name: "Confirmer l’utilisation" }), panel.getByRole("button", { name: "Annuler" })]) {
      await target.scrollIntoViewIfNeeded();
      await expect(target).toBeVisible();
      expect((await target.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
