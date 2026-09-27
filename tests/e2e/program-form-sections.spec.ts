import { expect, test, type Page } from "@playwright/test";
import { createMerchant } from "./helpers";

test.describe.configure({ timeout: 90_000 });

const program = (page: Page) => page.request.get("/api/program").then((response) => response.json());

test("programme : essentiel visible, sections avancées repliées sans perte de valeur", async ({ page }) => {
  await createMerchant(page, "program-sections");
  await page.goto("/dashboard/program");
  await expect(page.getByText("Définis les règles de ton programme de fidélité.")).toBeVisible();
  await expect(page.getByText(/47 pages/)).toHaveCount(0);

  // Essentiel : immédiatement visible.
  for (const label of ["Nom du programme", "Mode", "Seuil de récompense", "Récompense", "Tampons par passage"]) {
    await expect(page.getByLabel(label, { exact: true })).toBeVisible();
  }
  // Avancé : replié à l'ouverture.
  await expect(page.getByLabel("Plafond de gains par carte et par jour")).toBeHidden();
  await expect(page.getByLabel("Délai entre deux crédits")).toBeHidden();
  await expect(page.getByLabel("Nom de l’unité")).toBeHidden();

  // Valeurs saisies puis sections refermées : tout est enregistré.
  await page.getByText("Protection contre les abus").click();
  await page.getByLabel("Plafond de gains par carte et par jour").fill("3");
  await page.getByLabel("Délai entre deux crédits").selectOption("custom");
  await page.getByLabel("Délai personnalisé (secondes)").fill("90");
  await page.getByLabel("Validité d’une nouvelle carte (jours)").fill("365");
  await page.getByText("Protection contre les abus").click();
  await page.getByText("Personnalisation (facultatif)").click();
  await page.getByLabel("Nom de l’unité").fill("café");
  await page.getByLabel("Message affiché sur la carte").fill("Merci de votre fidélité");
  await page.getByText("Personnalisation (facultatif)").click();
  await expect(page.getByLabel("Nom de l’unité")).toBeHidden();
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByText("Programme enregistré.")).toBeVisible({ timeout: 15_000 });
  expect(await program(page)).toMatchObject({ daily_earn_limit: 3, cooldown_seconds: 90, expires_after_days: 365, unit_label: "café", card_message: "Merci de votre fidélité" });

  // Enregistrement sans ouvrir aucune section : rien n'est perdu ni normalisé.
  await page.reload();
  await page.getByLabel("Récompense", { exact: true }).fill("Un café offert");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByText("Programme enregistré.")).toBeVisible({ timeout: 15_000 });
  expect(await program(page)).toMatchObject({ reward_label: "Un café offert", daily_earn_limit: 3, cooldown_seconds: 90, expires_after_days: 365, unit_label: "café", card_message: "Merci de votre fidélité" });
});

test("programme : un champ avancé invalide rouvre sa section au lieu de bloquer en silence", async ({ page }) => {
  await createMerchant(page, "program-invalid");
  await page.goto("/dashboard/program");
  await page.getByText("Protection contre les abus").click();
  await page.getByLabel("Délai entre deux crédits").selectOption("custom");
  await page.getByLabel("Délai personnalisé (secondes)").fill("");
  await page.getByText("Protection contre les abus").click();
  await expect(page.getByLabel("Délai personnalisé (secondes)")).toBeHidden();
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByLabel("Délai personnalisé (secondes)")).toBeVisible();
  await expect(page.getByText("Programme enregistré.")).toHaveCount(0);
});

test("programme : points par euro et points par achat restent dans l'essentiel", async ({ page }) => {
  await createMerchant(page, "program-points");
  await page.goto("/dashboard/program");
  await page.getByLabel("Mode", { exact: true }).selectOption("POINTS");
  await expect(page.getByLabel("Points par achat")).toBeVisible();
  await page.getByLabel("Calcul des points").selectOption("PER_EURO");
  await page.getByLabel("Points par euro").fill("2");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByText("Programme enregistré.")).toBeVisible({ timeout: 15_000 });
  const saved = await program(page);
  expect(saved).toMatchObject({ mode: "POINTS", points_rule: "PER_EURO" });
  expect(Number(saved.points_per_euro)).toBe(2);
});

for (const width of [320, 390, 430]) {
  test(`programme lisible à ${width} px, sections dépliables sans débordement`, async ({ page }) => {
    await createMerchant(page, `program-${width}`);
    await page.setViewportSize({ width, height: 720 });
    await page.goto("/dashboard/program");
    for (const summary of ["Personnalisation (facultatif)", "Protection contre les abus"]) {
      const target = page.getByText(summary);
      expect((await target.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      await target.click();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  });
}
