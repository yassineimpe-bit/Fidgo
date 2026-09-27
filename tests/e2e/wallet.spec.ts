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
  // Vue commerçant : statut compréhensible, aucun nom de variable (#168).
  const appleCard = page.locator(".wallet-provider", { hasText: "Apple Wallet" });
  const googleCard = page.locator(".wallet-provider", { hasText: "Google Wallet" });
  await expect(appleCard.getByText("○ Non activé")).toBeVisible();
  await expect(googleCard.getByText("○ Non activé")).toBeVisible();
  await expect(appleCard).toContainText("0 carte active dans Apple Wallet");
  const main = page.locator("main");
  const diagnostic = page.locator("details.wallet-diagnostic");
  await expect(diagnostic).not.toHaveAttribute("open", "");
  await expect(page.getByText(/NEXT_PUBLIC_APP_URL|AUTH_SECRET|Vercel/).first()).toBeHidden();
  // Diagnostic avancé : tous les détails techniques restent consultables.
  await page.getByText("Diagnostic avancé (support technique)").click();
  await expect(diagnostic.getByText(/NEXT_PUBLIC_APP_URL/)).toBeVisible();
  await expect(diagnostic.getByRole("heading", { name: "Erreurs Wallet récentes" })).toBeVisible();
  await expect(diagnostic.getByRole("heading", { name: "Chemin vers le premier pass réel" })).toBeVisible();
  await expect(diagnostic.locator(".card", { hasText: "Apple Wallet" }).getByText("Désactivé")).toBeVisible();
  await expect(main).not.toContainText(/BEGIN (RSA |EC )?PRIVATE KEY|private_key/);
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 720 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `wallet @${width}px`).toBe(0);
  }

  await page.goto(cardUrl);
  await expect(page.getByRole("heading", { name: "Ajouter au portefeuille" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Apple Wallet" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Google Wallet" })).toBeDisabled();
});
