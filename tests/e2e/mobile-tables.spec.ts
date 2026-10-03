import { expect, test, type Page } from "@playwright/test";
import { createMerchant, enrollCustomer, openCardInScanner, unique } from "./helpers";

// Reproduit sur iPhone : body { overflow-wrap: anywhere } réduisait la largeur
// minimale de chaque cellule à un caractère, et les tableaux en width:100%
// se comprimaient au lieu de défiler (textes lettre par lettre, bouton
// « Annuler » vertical). Chromium ne remplace pas le retest Safari physique.
test.describe.configure({ timeout: 120_000 });

const PHONE_WIDTHS = [320, 375, 390, 430];

async function checkPhoneLayout(page: Page, path: string, width: number, name: string) {
  await page.setViewportSize({ width, height: 844 });
  await page.goto(path);
  const rows = page.locator("tbody tr");
  await expect(rows.first()).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${path} @${width}px : défilement horizontal de la page`).toBeLessThanOrEqual(0);

  const cells = rows.first().locator("td");
  const count = await cells.count();
  for (let index = 0; index < count; index += 1) {
    const box = await cells.nth(index).boundingBox();
    if (!box) continue;
    expect(box.width, `${path} @${width}px : cellule ${index} trop étroite`).toBeGreaterThanOrEqual(width * 0.6);
  }

  const buttons = rows.first().locator(".btn");
  for (let index = 0; index < await buttons.count(); index += 1) {
    const box = await buttons.nth(index).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height, `${path} @${width}px : bouton ${index} sur plusieurs lignes`).toBeLessThanOrEqual(48);
    expect(box!.width, `${path} @${width}px : bouton ${index} trop étroit`).toBeGreaterThanOrEqual(44);
  }
  await page.locator("section", { has: rows.first() }).last().screenshot({ path: test.info().outputPath(`${name}-${width}.png`) });
}

test("tableaux du dashboard : lisibles en cartes sur téléphone, tableau inchangé sur desktop", async ({ page }) => {
  await createMerchant(page, "mobile-tables");
  const { shortCode } = await enrollCustomer(page, "Marcel", `${unique("mobile-tables-client")}@example.com`);
  await openCardInScanner(page, shortCode);
  await page.getByRole("button", { name: "+1 tampon" }).click();
  await expect(page.getByText("+1 validé")).toBeVisible({ timeout: 15_000 });

  await page.goto("/dashboard/clients");
  await page.getByRole("link", { name: "Marcel" }).click();
  await page.waitForURL(/\/dashboard\/clients\/[0-9a-f-]+$/);
  const customerPath = new URL(page.url()).pathname;

  for (const width of PHONE_WIDTHS) {
    for (const [name, path] of [["dashboard", "/dashboard"], ["historique", "/dashboard/transactions"], ["clients", "/dashboard/clients"], ["fiche-client", customerPath]]) {
      await checkPhoneLayout(page, path, width, name);
    }
  }

  // Libellé lisible (et non le type brut « earn ») sur le tableau de bord.
  await page.goto("/dashboard");
  await expect(page.getByRole("cell", { name: "Crédit", exact: true })).toBeVisible();
  // Les en-têtes restent annoncés et les cellules gardent leur nom accessible.
  await page.goto("/dashboard/transactions");
  await expect(page.getByRole("columnheader", { name: "Client" })).toBeAttached();
  await expect(page.getByRole("cell", { name: "Crédit", exact: true })).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 800 });
  for (const path of ["/dashboard/transactions", "/dashboard/clients"]) {
    await page.goto(path);
    await expect(page.locator("thead")).toBeVisible();
    expect(await page.locator("tbody td").first().evaluate((cell) => getComputedStyle(cell).display)).toBe("table-cell");
  }
});
