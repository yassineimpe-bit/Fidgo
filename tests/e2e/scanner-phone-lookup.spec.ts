import { expect, test } from "@playwright/test";
import { createMerchant, unique } from "./helpers";

test("scanner : un client peut être retrouvé par téléphone malgré le formatage", async ({ page }) => {
  await createMerchant(page, "phone-lookup");
  const joinPath = await page.locator("code").filter({ hasText: "/j/" }).textContent();
  expect(joinPath).toMatch(/^\/j\//);

  await page.goto(joinPath!);
  await page.getByLabel(/Prénom/).fill("Nora");
  await page.getByLabel(/Email/).fill(`${unique("phone-client")}@example.com`);
  await page.getByLabel(/Téléphone/).fill("+33 6 12 34 56 78");
  await page.getByRole("button", { name: "Créer ma carte" }).click();
  await expect(page).toHaveURL(/\/c\//);

  await page.goto("/dashboard/clients?q=0612345678");
  await expect(page.getByText("Nora")).toBeVisible();

  await page.goto("/s");
  await page.getByPlaceholder("Code court ou email, ou téléphone").fill("06 12 34 56 78");
  await page.getByRole("button", { name: "Chercher" }).click();
  await expect(page.getByText("Nora")).toBeVisible();
  await expect(page.getByText(/0 \/ 10 tampons/)).toBeVisible();
});
