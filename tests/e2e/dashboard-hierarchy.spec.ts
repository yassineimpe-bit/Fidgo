import { expect, test } from "@playwright/test";
import { createMerchant } from "./helpers";

test.describe.configure({ timeout: 90_000 });

test("dashboard : KPI métier au premier niveau, télémétrie scanner repliée mais disponible", async ({ page }) => {
  await createMerchant(page, "dashboard-hierarchy");
  await page.goto("/dashboard");
  const essentials = page.getByRole("region", { name: "L’essentiel" });
  for (const label of ["clients inscrits", "scans du jour", "récompenses disponibles", "récompenses utilisées"]) {
    await expect(essentials.locator(".metric", { hasText: label })).toBeVisible();
  }
  for (const label of ["p50 QR → fiche client", "p95 QR → fiche client", "taux d’erreur scanner", "scans échoués"]) {
    await expect(page.getByText(label)).toBeHidden();
  }
  await expect(page.getByText(/credentials/)).toHaveCount(0);
  await page.getByText("Indicateurs techniques du scanner (pilote)").click();
  for (const label of ["p50 QR → fiche client", "p95 QR → fiche client", "taux d’erreur scanner", "scans réussis", "conversion inscription"]) {
    await expect(page.getByText(label)).toBeVisible();
  }
  // L'étape suivante et la checklist restent en place.
  await expect(page.getByText("Étape suivante", { exact: true })).toBeVisible();
});

test("analytics : essentiel d'abord, analyses avancées identifiées et accessibles, états vides expliqués", async ({ page }) => {
  await createMerchant(page, "analytics-hierarchy");
  await page.goto("/dashboard/analytics");
  await expect(page.getByRole("heading", { name: "L’essentiel" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fidélisation" })).toBeVisible();
  await expect(page.getByText(/centrale nucléaire/)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Segmentation RFM" })).toBeHidden();
  await page.getByText("Analyses avancées : cohortes et segmentation RFM").click();
  await expect(page.getByText("Aucune cohorte pour l’instant.")).toBeVisible();
  await expect(page.getByText("Elles apparaissent dès les premières inscriptions de clients.")).toBeVisible();
  await expect(page.getByText("La segmentation apparaît dès qu’un client a une visite créditée.")).toBeVisible();
});

for (const width of [320, 390, 430]) {
  test(`dashboard et analytics sans débordement à ${width} px`, async ({ page }) => {
    await createMerchant(page, `hierarchy-${width}`);
    await page.setViewportSize({ width, height: 720 });
    for (const path of ["/dashboard", "/dashboard/analytics"]) {
      await page.goto(path);
      for (const summary of await page.locator("details.disclosure > summary").all()) {
        expect((await summary.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
        await summary.click();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${path} @${width}px`).toBe(0);
    }
  });
}
