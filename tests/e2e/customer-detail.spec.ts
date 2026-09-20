import { expect, test } from "@playwright/test";
import { createMerchant, enrollCustomer, openCardInScanner, unique } from "./helpers";

test("fiche client : profil, solde et historique sont accessibles depuis la liste", async ({ page }) => {
  await createMerchant(page, "customer-detail");
  const email = `${unique("customer-detail")}@example.com`;
  const { shortCode } = await enrollCustomer(page, "Maya", email);

  await openCardInScanner(page, shortCode);
  await page.getByRole("button", { name: "+1 tampon" }).click();
  await expect(page.getByText("+1 validé")).toBeVisible();

  await page.goto("/dashboard/clients");
  await page.getByRole("link", { name: "Maya" }).click();
  await expect(page).toHaveURL(/\/dashboard\/clients\//);
  await expect(page.getByRole("heading", { name: "Maya" })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByText("1", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "Crédit", exact: true })).toBeVisible();
  await expect(page.getByText("+1", { exact: true })).toBeVisible();
});


test("fiche client : un autre commerce ne peut pas accéder au client", async ({ page }) => {
  await createMerchant(page, "customer-detail-tenant-a");
  const { shortCode } = await enrollCustomer(page, "Lina", `${unique("tenant-a-client")}@example.com`);

  await page.goto("/dashboard/clients");
  await page.getByRole("link", { name: "Lina" }).click();
  await expect(page).toHaveURL(/\/dashboard\/clients\/[0-9a-f-]+$/);
  const customerPath = new URL(page.url()).pathname;
  expect(customerPath).toMatch(/^\/dashboard\/clients\/[0-9a-f-]+$/);

  const otherContext = await page.context().browser()!.newContext();
  const otherPage = await otherContext.newPage();
  try {
    await createMerchant(otherPage, "customer-detail-tenant-b");
    const response = await otherPage.request.get(customerPath);
    expect(response.status()).toBe(404);

    // La carte du tenant A reste évidemment introuvable dans le scanner du tenant B.
    const scanLookup = await otherPage.request.get(`/api/lookup?q=${encodeURIComponent(shortCode)}`);
    expect(scanLookup.status()).toBe(404);
  } finally {
    await otherContext.close();
  }
});
