import { expect, test } from "@playwright/test";
import { createMerchant, enrollCustomer, origin } from "./helpers";

test("apparence de la carte : couleur secondaire, dégradé, aperçu et carte client", async ({ page }) => {
  test.setTimeout(90_000);
  await createMerchant(page, "card-design");

  // Validation serveur.
  const badColor = await page.request.patch("/api/restaurant", { headers: { origin }, data: { secondaryColor: "red" } });
  expect(badColor.status()).toBe(400);
  expect(await badColor.json()).toEqual({ error: "INVALID_FIELD", field: "secondaryColor" });
  const badBackground = await page.request.patch("/api/restaurant", { headers: { origin }, data: { cardBackground: "video" } });
  expect(await badBackground.json()).toEqual({ error: "INVALID_FIELD", field: "cardBackground" });
  // Pas de dégradé sans couleur secondaire : couleur unie conservée.
  expect((await page.request.patch("/api/restaurant", { headers: { origin }, data: { cardBackground: "gradient" } })).ok()).toBeTruthy();
  expect(await page.request.get("/api/restaurant").then((response) => response.json())).toMatchObject({ secondary_color: null, card_background: "solid" });

  // Réglages : couleur principale, secondaire, dégradé, aperçu en temps réel.
  await page.goto("/dashboard/settings");
  await page.getByLabel("Code hexadécimal de la couleur").fill("#111111");
  const preview = page.getByLabel("Aperçu de la carte fidélité");
  await expect(page.getByLabel("Fond de la carte")).toBeDisabled();
  await page.getByLabel("Couleur secondaire").fill("#fde047");
  await page.getByLabel("Fond de la carte").selectOption("gradient");
  await expect(preview).toHaveCSS("background-image", "linear-gradient(135deg, rgb(17, 17, 17) 0%, rgb(253, 224, 71) 100%)");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByText("Commerce enregistré.")).toBeVisible({ timeout: 15_000 });
  expect(await page.request.get("/api/restaurant").then((response) => response.json())).toMatchObject({ secondary_color: "#fde047", card_background: "gradient" });

  // Carte client : même dégradé.
  await page.goto("/dashboard");
  const { cardUrl } = await enrollCustomer(page, "Design", `design-${Date.now()}@example.com`);
  await page.goto(cardUrl);
  await expect(page.locator(".loyalty-card")).toHaveCSS("background-image", "linear-gradient(135deg, rgb(17, 17, 17) 0%, rgb(253, 224, 71) 100%)");

  // Couleur unie : la secondaire devient l'accent de la barre de progression.
  expect((await page.request.patch("/api/restaurant", { headers: { origin }, data: { cardBackground: "solid" } })).ok()).toBeTruthy();
  await page.reload();
  await expect(page.locator(".loyalty-card")).toHaveCSS("background-color", "rgb(17, 17, 17)");
  await expect(page.locator(".loyalty-card .progress > span")).toHaveCSS("background-color", "rgb(253, 224, 71)");

  // Retrait de la couleur secondaire : retour à la couleur unie sans accent.
  expect((await page.request.patch("/api/restaurant", { headers: { origin }, data: { secondaryColor: null } })).ok()).toBeTruthy();
  expect(await page.request.get("/api/restaurant").then((response) => response.json())).toMatchObject({ secondary_color: null, card_background: "solid" });
});
