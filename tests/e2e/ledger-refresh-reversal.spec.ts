import { expect, test, type Page, type Request } from "@playwright/test";
import { createMerchant, enrollCustomer, openCardInScanner, unique } from "./helpers";

test.describe.configure({ timeout: 90_000 });

async function merchantWithCredit(page: Page, label: string) {
  await createMerchant(page, label);
  const { shortCode } = await enrollCustomer(page, "Lina", `${unique(`${label}-client`)}@example.com`);
  await openCardInScanner(page, shortCode);
  await page.getByRole("button", { name: "+1 tampon" }).click();
  await expect(page.getByText("+1 validé")).toBeVisible({ timeout: 15_000 });
}

function watchReverse(page: Page) {
  const requests: Request[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/transactions/reverse") requests.push(request);
  });
  return requests;
}

const rows = (page: Page) => page.locator("tbody tr");

test("annulation : contre-écriture affichée sans rechargement, origine marquée annulée, double clic neutralisé", async ({ page }) => {
  await merchantWithCredit(page, "reverse-refresh");
  await page.goto("/dashboard/transactions");
  await expect(rows(page)).toHaveCount(1);
  const requests = watchReverse(page);
  let confirmText = "";
  page.on("dialog", (dialog) => { confirmText = dialog.message(); void dialog.accept(); });
  // Témoin posé dans la page : un rechargement complet le ferait disparaître.
  await page.evaluate(() => { (window as unknown as { __noReload?: boolean }).__noReload = true; });

  await rows(page).first().getByRole("button", { name: "Annuler" }).dblclick();
  await expect(page.locator(".notice[role=status]")).toHaveText("Transaction annulée.", { timeout: 15_000 });
  expect(confirmText).toBe("Confirmer l’annulation ? Le solde du client sera mis à jour.");
  await expect(page.getByText(/Recharge la page/)).toHaveCount(0);

  // La contre-écriture apparaît automatiquement, l'origine reste visible comme annulée.
  await expect(rows(page)).toHaveCount(2, { timeout: 15_000 });
  await expect(rows(page).filter({ hasText: "Annulation" })).toContainText("-1");
  await expect(rows(page).filter({ hasText: "· annulée" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Annuler" })).toHaveCount(0);
  expect(requests).toHaveLength(1);
  expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);
});

test("annulation : réponse perdue puis relance avec la même clé, une seule contre-écriture", async ({ page }) => {
  await merchantWithCredit(page, "reverse-lost");
  await page.goto("/dashboard/transactions");
  const requests = watchReverse(page);
  page.on("dialog", (dialog) => void dialog.accept());
  await page.route("**/api/transactions/reverse", async (route) => {
    await route.fetch();
    await route.abort("internetdisconnected");
  });
  await rows(page).first().getByRole("button", { name: "Annuler" }).click();
  await expect(page.locator(".notice[role=alert]")).toContainText("l’annulation n’a pas été confirmée", { timeout: 15_000 });

  await page.unroute("**/api/transactions/reverse");
  await rows(page).first().getByRole("button", { name: "Annuler" }).click();
  await expect(page.locator(".notice[role=status]")).toHaveText("Transaction annulée.", { timeout: 15_000 });
  expect(requests).toHaveLength(2);
  const keys = requests.map((request) => (request.postDataJSON() as { idempotencyKey: string }).idempotencyKey);
  expect(keys[0]).toBe(keys[1]);
  await expect(rows(page)).toHaveCount(2, { timeout: 15_000 });
  await expect(rows(page).filter({ hasText: "Annulation" })).toHaveCount(1);
});

test("annulation : utilisable à 320 px", async ({ page }) => {
  await merchantWithCredit(page, "reverse-mobile");
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/dashboard/transactions");
  page.on("dialog", (dialog) => void dialog.accept());
  const button = rows(page).first().getByRole("button", { name: "Annuler" });
  await button.scrollIntoViewIfNeeded();
  expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await button.click();
  await expect(page.locator(".notice[role=status]")).toHaveText("Transaction annulée.", { timeout: 15_000 });
  await expect(rows(page)).toHaveCount(2, { timeout: 15_000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});
