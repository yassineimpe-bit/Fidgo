import { expect, test } from "@playwright/test";
import { createMerchant, enrollCustomer } from "./helpers";

// Sans secrets Apple/Google configurés (cas par défaut, y compris en CI),
// Retiko doit rester utilisable de bout en bout : les boutons Wallet se
// désactivent proprement au lieu de casser la page ou de mentir sur l'état.
test("wallet : reste \"prêt à activer\" sans secrets configurés", async ({ page }) => {
  await createMerchant(page, "wallet");
  const { cardUrl } = await enrollCustomer(page, "Camille", `${Date.now()}@example.com`);

  await page.goto("/dashboard/wallet");
  await expect(page.getByRole("heading", { name: "État Apple Wallet / Google Wallet" })).toBeVisible();
  const appleCard = page.locator(".card", { hasText: "Apple Wallet" });
  const googleCard = page.locator(".card", { hasText: "Google Wallet" });
  await expect(appleCard.getByText("Désactivé")).toBeVisible();
  await expect(googleCard.getByText("Désactivé")).toBeVisible();

  await page.goto(cardUrl);
  await expect(page.getByRole("heading", { name: "Ajouter au portefeuille" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Apple Wallet" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Google Wallet" })).toBeDisabled();
});
