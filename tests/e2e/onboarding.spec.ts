import { expect, test } from "@playwright/test";
import { createMerchant } from "./helpers";

test("onboarding : étape suivante et empty states avant toute activité", async ({ page }) => {
  await createMerchant(page, "onboarding");

  // Fraîchement inscrit, sans logo : la checklist pointe vers la configuration
  // du commerce, pas vers le premier test.
  await expect(page.getByText(/Étape suivante : personnalise ton commerce/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Configurer mon commerce" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Compte créé/ })).toBeVisible();

  await page.goto("/dashboard/clients");
  await expect(page.getByText("Aucun client pour l’instant.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Voir mon affiche QR" })).toBeVisible();

  await page.goto("/dashboard/transactions");
  await expect(page.getByText("Aucun passage enregistré.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Ouvrir le scanner" })).toBeVisible();

  await page.goto("/dashboard/employees");
  await expect(page.getByText(/Aucun accès caisse créé/)).toBeVisible();

  // L'affiche QR doit rester utilisable sans NEXT_PUBLIC_APP_URL explicite.
  await page.goto("/dashboard/poster");
  await expect(page.getByRole("img", { name: "QR inscription fidélité" })).toBeVisible();
  await expect(page.getByText(/Scanne pour créer ta carte fidélité/)).toBeVisible();
});
