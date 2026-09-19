import { expect, test } from "@playwright/test";
import { createMerchant, enrollCustomer, openCardInScanner, unique } from "./helpers";

test("historique : recherche et filtres transactionnels restent limités au commerce courant", async ({ page }) => {
  await createMerchant(page, "history-filter");
  const customerEmail = `${unique("history-client")}@example.com`;
  const { shortCode } = await enrollCustomer(page, "Camille", customerEmail);

  await openCardInScanner(page, shortCode);
  await page.getByRole("button", { name: "+1 tampon" }).click();
  await expect(page.getByText("+1 validé")).toBeVisible();

  await page.goto("/dashboard/transactions");
  await expect(page.getByText("Camille")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Crédit", exact: true })).toBeVisible();

  await page.getByLabel("Client, code ou employé").fill("introuvable");
  await page.getByRole("button", { name: "Filtrer" }).click();
  await expect(page).toHaveURL(/q=introuvable/);
  await expect(page.getByText(/0 transaction/)).toBeVisible();
  await expect(page.getByText("Aucun passage enregistré.")).toBeVisible();

  await page.goto("/dashboard/transactions");
  await page.getByLabel("Type").selectOption("redeem");
  await page.getByRole("button", { name: "Filtrer" }).click();
  await expect(page).toHaveURL(/type=redeem/);
  await expect(page.getByText(/0 transaction/)).toBeVisible();

  await page.goto("/dashboard/transactions");
  await page.getByLabel("Type").selectOption("earn");
  await page.getByLabel("Période").selectOption("7");
  await page.getByRole("button", { name: "Filtrer" }).click();
  await expect(page).toHaveURL(/type=earn/);
  await expect(page).toHaveURL(/period=7/);
  await expect(page.getByText("Camille")).toBeVisible();
});
