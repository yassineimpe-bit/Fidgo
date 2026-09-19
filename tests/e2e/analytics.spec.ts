import { expect, test } from "@playwright/test";
import { createMerchant } from "./helpers";

test("analytics : période sélectionnable et état vide exploitable", async ({ page }) => {
  await createMerchant(page, "analytics");
  await page.goto("/dashboard/analytics");

  await expect(page.getByRole("heading", { name: "Activité du programme" })).toBeVisible();
  await expect(page.getByText("Pas encore d’activité sur cette période.")).toBeVisible();

  await page.getByRole("link", { name: "7 jours" }).click();
  await expect(page).toHaveURL(/period=7/);
  await expect(page.getByText("nouveaux clients")).toBeVisible();
  await expect(page.getByText("p95 QR → fiche client")).toBeVisible();
});
