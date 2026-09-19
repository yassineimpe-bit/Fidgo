import { expect, test } from "@playwright/test";
import { createMerchant, enrollCustomer, openCardInScanner, unique } from "./helpers";

test("transactions : OWNER peut exporter le ledger filtré en CSV", async ({ page }) => {
  await createMerchant(page, "transaction-export");
  const { shortCode } = await enrollCustomer(page, "Camille", `${unique("csv-client")}@example.com`);
  await openCardInScanner(page, shortCode);
  await page.getByRole("button", { name: "+1 tampon" }).click();
  await expect(page.getByText("+1 validé")).toBeVisible();

  const response = await page.request.get("/api/transactions/export?type=earn&period=7");
  expect(response.ok()).toBeTruthy();
  expect(response.headers()["content-type"]).toContain("text/csv");
  expect(response.headers()["content-disposition"]).toContain("retiko-transactions-");
  const csv = await response.text();
  expect(csv).toContain("Date;Client;Code carte;Type");
  expect(csv).toContain("Camille");
  expect(csv).toContain(shortCode);
  expect(csv).toContain(";earn;");
});
