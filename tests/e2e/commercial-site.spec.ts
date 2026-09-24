import { expect, test } from "@playwright/test";

test("site commercial : parcours, Wallet, fidélité, prix et CTA sont présentés", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Le QR fidélité pensé pour le rush." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Du QR à la récompense en quatre étapes." })).toBeVisible();
  await expect(page.getByText("Le client scanne ton QR")).toBeVisible();
  await expect(page.getByText("Tu scans sa carte")).toBeVisible();
  await expect(page.getByText("Tu crédites")).toBeVisible();
  await expect(page.getByText("La carte se met à jour")).toBeVisible();

  await expect(page.getByRole("heading", { name: "Apple Wallet et Google Wallet." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tampons ou points." })).toBeVisible();
  await expect(page.getByText("QR d’inscription")).toBeVisible();
  await expect(page.getByText("Scanner commerçant")).toBeVisible();

  await expect(page.getByText("19,99 € HT/mois")).toBeVisible();
  await expect(page.getByText("210 € HT/an")).toBeVisible();
  await expect(page.getByText("24,99 € HT/mois")).toBeVisible();
  await expect(page.getByRole("link", { name: "Démarrer l’essai" }).first()).toHaveAttribute("href", "/signup");

  await expect(page).toHaveTitle(/Carte de fidélité digitale pour restaurants/);
  const description = await page.locator('meta[name="description"]').getAttribute("content");
  expect(description).toContain("carte de fidélité digitale");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/$/);
});

test("site commercial : la landing reste lisible sur mobile sans débordement horizontal", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Le QR fidélité pensé pour le rush." })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  await expect(page.getByText("19,99 € HT/mois")).toBeVisible();
});
