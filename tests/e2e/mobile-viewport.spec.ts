import { expect, test } from "@playwright/test";
import { createMerchant, enrollCustomer } from "./helpers";

const DASHBOARD_PAGES = [
  "/dashboard",
  "/dashboard/clients",
  "/dashboard/transactions",
  "/dashboard/employees",
  "/dashboard/program",
  "/dashboard/settings",
  "/dashboard/billing",
  "/dashboard/wallet",
  "/dashboard/poster",
];

async function horizontalOverflow(page: import("@playwright/test").Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

for (const width of [320, 375, 390, 430]) {
  test(`dashboard mobile @${width}px : aucun débordement horizontal`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await createMerchant(page, `mobile${width}`);

    for (const path of DASHBOARD_PAGES) {
      await page.goto(path);
      await expect(page.locator("body")).toBeVisible();
      expect(await horizontalOverflow(page), `${path} @${width}px`).toBe(0);
    }
  });
}

test("menu mobile : tous les écrans restent atteignables sans taper une URL", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await createMerchant(page, "navmenu");

  // Fermé par défaut : seul Scanner reste visible hors du menu.
  await expect(page.getByRole("link", { name: "Clients" })).toBeHidden();

  await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  for (const label of ["Dashboard", "Clients", "Programme", "Transactions", "Équipe", "Commerce", "Facturation", "Wallet", "Affiche QR"]) {
    await expect(page.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Déconnexion" })).toBeVisible();

  await page.getByRole("link", { name: "Clients" }).click();
  await expect(page).toHaveURL(/\/dashboard\/clients$/);
  // La navigation referme le menu au lieu de le laisser ouvert par-dessus la nouvelle page.
  await expect(page.getByRole("link", { name: "Programme" })).toBeHidden();
});

test("menu mobile : Échap et clic extérieur referment le menu", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await createMerchant(page, "navmenuclose");

  await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  await expect(page.getByRole("link", { name: "Clients" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("link", { name: "Clients" })).toBeHidden();

  await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  await expect(page.getByRole("link", { name: "Clients" })).toBeVisible();
  await page.mouse.click(10, 400);
  await expect(page.getByRole("link", { name: "Clients" })).toBeHidden();
});

for (const width of [320, 390, 430]) {
  test(`menu mobile @${width}px : liens groupés par usage, cibles ≥ 44 px, focus rendu au bouton`, async ({ page }) => {
    await page.setViewportSize({ width, height: 640 });
    await createMerchant(page, `navgroups${width}`);

    // Scanner reste l'action primaire de l'en-tête, hors du menu.
    const scanner = page.locator(".app-nav-mobile-primary");
    await expect(scanner).toBeVisible();
    expect((await scanner.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

    const toggle = page.getByRole("button", { name: "Ouvrir le menu" });
    await toggle.click();
    const menu = page.locator("#mobile-nav-dropdown");
    const expected: [string, string[]][] = [
      ["Au quotidien", ["Dashboard", "Clients", "Transactions", "Analytics", "Campagnes"]],
      ["Configuration", ["Programme", "Commerce", "Équipe"]],
      ["Compte", ["Wallet", "Facturation", "Affiche QR", "Sécurité"]],
    ];
    for (const [title, labels] of expected) {
      const group = menu.getByRole("group", { name: title });
      await expect(group.getByRole("link")).toHaveText(labels);
    }
    await expect(menu.getByRole("link", { name: "Scanner" })).toHaveCount(0);

    // Menu plus haut que l'écran : il défile au lieu de sortir de la vue.
    const last = menu.getByRole("link", { name: "Sécurité" });
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    const box = await last.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(await horizontalOverflow(page)).toBe(0);

    await page.keyboard.press("Escape");
    await expect(menu.getByRole("link", { name: "Clients" })).toBeHidden();
    await expect(toggle).toBeFocused();
  });
}

test("desktop : la navigation complète reste visible sans menu hamburger", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await createMerchant(page, "navdesktop");

  for (const label of ["Dashboard", "Clients", "Programme", "Transactions", "Équipe", "Commerce", "Facturation", "Wallet", "Affiche QR"]) {
    await expect(page.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: /menu/i })).toBeHidden();
});

test("carte client mobile : solde, progression, QR et code court lisibles sans débordement", async ({ page, context }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await createMerchant(page, "cardmobile");
  const { cardUrl } = await enrollCustomer(page, "Camille", `${Date.now()}@example.com`);

  const cardPage = await context.newPage();
  await cardPage.setViewportSize({ width: 375, height: 800 });
  await cardPage.goto(cardUrl);

  await expect(cardPage.getByText(/\d+ \/ \d+/)).toBeVisible();
  await expect(cardPage.getByRole("img", { name: "QR code fidélité" })).toBeVisible();
  const qrBox = await cardPage.getByRole("img", { name: "QR code fidélité" }).boundingBox();
  expect(qrBox?.width).toBeGreaterThan(140);
  expect(await horizontalOverflow(cardPage)).toBe(0);
});
