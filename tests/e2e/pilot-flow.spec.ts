import { expect, test } from "@playwright/test";
import { createMerchant, enrollCustomer, openCardInScanner, origin, unique } from "./helpers";

test("boucle pilote : inscription, crédit, override, auto-refresh et récompense", async ({ page }) => {
  const customerEmail = `${unique("client")}@example.com`;
  await createMerchant(page, "boucle");
  const { cardUrl, shortCode } = await enrollCustomer(page, "Camille", customerEmail);

  const cardPage = await page.context().newPage();
  await cardPage.goto(cardUrl);
  await expect(cardPage.getByText("0 / 10")).toBeVisible();

  await openCardInScanner(page, shortCode);
  await page.getByRole("button", { name: "+1 tampon" }).click();
  await expect(page.getByText("+1 validé")).toBeVisible();
  await expect(cardPage.getByText("1 / 10")).toBeVisible({ timeout: 8_000 });

  await page.waitForTimeout(1_400);
  await openCardInScanner(page, shortCode);
  await page.getByRole("button", { name: "+1 tampon" }).click();
  await expect(page.getByText(/Passage déjà enregistré/)).toBeVisible();
  await page.getByLabel("Motif obligatoire pour créditer quand même").fill("Second achat distinct");
  await page.getByRole("button", { name: "Créditer quand même" }).click();
  await expect(page.getByText("+1 validé")).toBeVisible();
  await expect(cardPage.getByText("2 / 10")).toBeVisible({ timeout: 8_000 });

  await page.goto("/dashboard/clients");
  const exportHref = await page.getByRole("link", { name: "Exporter" }).getAttribute("href");
  const customerId = exportHref?.match(/\/api\/customers\/([^/]+)\/export/)?.[1];
  expect(customerId).toBeTruthy();
  const adjustment = await page.request.post(`/api/customers/${customerId}/adjust`, {
    headers: { origin },
    data: { newBalance: 10, reason: "Préparation test récompense", idempotencyKey: crypto.randomUUID() },
  });
  expect(adjustment.ok()).toBeTruthy();
  await expect(cardPage.getByText("10 / 10")).toBeVisible({ timeout: 8_000 });

  await openCardInScanner(page, shortCode);
  await expect(page.getByText(/Récompense disponible/)).toBeVisible();
  await page.getByRole("button", { name: "Utiliser récompense" }).click();
  await expect(page.getByText(/utilisée/)).toBeVisible();
  await expect(cardPage.getByText("0 / 10")).toBeVisible({ timeout: 8_000 });

  // Instrumentation pilote : JOIN_PAGE_VIEW/SCAN_SUCCESS doivent avoir été
  // enregistrés et agrégés, sans quoi ce compteur resterait à zéro.
  await page.goto("/dashboard");
  const scanSuccessMetric = page.locator(".metric", { hasText: "scans réussis" }).locator("strong");
  await expect(scanSuccessMetric).toBeVisible();
  await expect(scanSuccessMetric).not.toHaveText("0");
});
