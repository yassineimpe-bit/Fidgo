import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { createMerchant, enrollCustomer, origin, unique } from "./helpers";

test.describe.configure({ timeout: 120_000 });

test("personnalisation : avertissement de contraste en temps réel, sans toucher à la couleur, et aperçus Wallet", async ({ page }) => {
  await createMerchant(page, "contrast");
  await page.goto("/dashboard/settings");
  const hex = page.getByLabel("Code hexadécimal de la couleur");
  const warning = page.locator(".contrast-warning");

  await hex.fill("#111111");
  await expect(warning).toHaveCount(0);
  await hex.fill("#ff6600");
  await expect(warning).toContainText("Contraste faible entre le texte blanc et la couleur principale");
  // La couleur choisie n'est jamais modifiée.
  await expect(hex).toHaveValue("#ff6600");
  await expect(page.getByLabel("Aperçu de la carte fidélité")).toHaveCSS("background-color", "rgb(255, 102, 0)");

  await hex.fill("#111111");
  await page.getByLabel("Couleur secondaire").fill("#222222");
  await expect(warning).toContainText("la barre de progression utilise la couleur du texte");

  // Aperçus Wallet : couleur principale unie ; texte Apple lisible sur fond clair.
  await hex.fill("#fde047");
  await page.getByText("Aperçu Apple Wallet et Google Wallet").click();
  await expect(page.getByText("Google choisit lui-même la couleur du texte.", { exact: false })).toBeVisible();
  const apple = page.getByLabel("Aperçu Apple Wallet");
  await expect(apple).toHaveCSS("background-color", "rgb(253, 224, 71)");
  await expect(apple).toHaveCSS("color", "rgb(0, 0, 0)");
  await expect(page.getByLabel("Aperçu Google Wallet")).toHaveCSS("background-color", "rgb(253, 224, 71)");

  // Mobile : l'aperçu est accessible sans parcourir tout le formulaire.
  await page.setViewportSize({ width: 390, height: 780 });
  const jump = page.getByRole("link", { name: "Voir l’aperçu de la carte" });
  await expect(jump).toBeVisible();
  await jump.click();
  await expect(page.getByLabel("Aperçu de la carte fidélité")).toBeInViewport();
});

test("visuel de carte : le voile est une option visible, retirable, sans imposer d'assombrissement", async ({ page }) => {
  await createMerchant(page, "overlay");
  const invalid = await page.request.patch("/api/restaurant", { headers: { origin }, data: { cardImageOverlay: "no" } });
  expect(invalid.status()).toBe(400);
  expect(await invalid.json()).toEqual({ error: "INVALID_FIELD", field: "cardImageOverlay" });

  await page.goto("/dashboard/settings");
  const photo = await sharp({ create: { width: 1600, height: 800, channels: 3, background: "#f5f5f4" } }).jpeg().toBuffer();
  await page.getByLabel("Importer un visuel").setInputFiles({ name: "vitrine.jpg", mimeType: "image/jpeg", buffer: photo });
  await expect(page.getByText("Visuel importé.")).toBeVisible({ timeout: 15_000 });

  const overlay = page.getByLabel("Assombrir le visuel (voile) pour garder le texte lisible");
  await expect(overlay).toBeChecked();
  const preview = page.getByLabel("Aperçu de la carte fidélité");
  await expect(preview).toHaveCSS("background-image", /linear-gradient/);
  await overlay.uncheck();
  await expect(preview).not.toHaveCSS("background-image", /linear-gradient/);
  await expect(page.locator(".contrast-warning")).toContainText("Sans voile");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByText("Commerce enregistré.")).toBeVisible();
  expect(await page.request.get("/api/restaurant").then((response) => response.json())).toMatchObject({ card_background: "image", card_image_overlay: false });

  await page.goto("/dashboard");
  const { cardUrl } = await enrollCustomer(page, "Voile", `${unique("overlay")}@example.com`);
  await page.goto(cardUrl);
  const card = page.locator(".loyalty-card");
  await expect(card).toHaveCSS("background-image", /url\(/);
  await expect(card).not.toHaveCSS("background-image", /linear-gradient/);
  await expect(card).toHaveCSS("text-shadow", /rgba\(0, 0, 0, 0\.7\)/);

  // Réactivation explicite.
  expect((await page.request.patch("/api/restaurant", { headers: { origin }, data: { cardImageOverlay: true } })).ok()).toBeTruthy();
  await page.reload();
  await expect(card).toHaveCSS("background-image", /linear-gradient/);
});
