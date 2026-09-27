import { expect, test } from "@playwright/test";
import { createMerchant, enrollCustomer } from "./helpers";

// Sans secrets Apple/Google configurés (cas par défaut, y compris en CI),
// Retiko doit rester utilisable de bout en bout : les boutons Wallet ne sont
// pas proposés au client au lieu de casser la page ou de mentir sur l'état.
test("wallet : reste \"prêt à activer\" sans secrets configurés", async ({ page }) => {
  await createMerchant(page, "wallet");
  const { cardUrl } = await enrollCustomer(page, "Camille", `${Date.now()}@example.com`);

  await page.goto("/dashboard/wallet");
  await expect(page.getByRole("heading", { name: "État Apple Wallet / Google Wallet" })).toBeVisible();
  const appleCard = page.locator(".card", { hasText: "Apple Wallet" });
  const googleCard = page.locator(".card", { hasText: "Google Wallet" });
  await expect(appleCard.getByText("Désactivé")).toBeVisible();
  await expect(googleCard.getByText("Désactivé")).toBeVisible();

  // Côté client : aucun bouton mort ni jargon d'infrastructure (#167).
  await page.goto(cardUrl);
  await expect(page.getByRole("heading", { name: "Garder ta carte" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ajouter au portefeuille" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Apple Wallet|Google Wallet/ })).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText(/HTTPS|émetteur|issuer|credentials/i);
});
