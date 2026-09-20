import { expect, test } from "@playwright/test";
import { createMerchant, enrollCustomer, openCardInScanner, origin, unique } from "./helpers";

// Ce scénario traverse volontairement toute la boucle pilote et déclenche
// plusieurs compilations Next à froid en CI. La limite Playwright par défaut
// de 30 s rendait le test flaky sans signaler une régression applicative.
test.setTimeout(60_000);

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


test("programme : une carte existante survit aux réglages et le mode points crédite réellement", async ({ page }) => {
  await createMerchant(page, "program-change");
  const first = await enrollCustomer(page, "Carte existante", `${unique("existing-card")}@example.com`);
  const firstToken = first.cardUrl.split("/c/")[1];

  const firstCredit = await page.request.post("/api/credit", {
    headers: { origin },
    data: { token: firstToken, idempotencyKey: crypto.randomUUID() },
  });
  expect(firstCredit.ok()).toBeTruthy();
  await expect(firstCredit.json()).resolves.toMatchObject({ balance: 1, delta: 1, mode: "STAMPS" });

  const current = await page.request.get("/api/program").then((response) => response.json());
  const stampUpdate = await page.request.patch("/api/program", {
    headers: { origin },
    data: {
      programName: current.program_name,
      mode: "STAMPS",
      pointsRule: "PER_PURCHASE",
      rewardThreshold: 5,
      rewardLabel: "Cookie offert",
      cardMessage: "Toujours la même carte",
      stampsPerVisit: 1,
      pointsPerPurchase: 7,
      pointsPerEuro: 1,
      dailyEarnLimit: 0,
      cooldownSeconds: 120,
      expiresAfterDays: null,
    },
  });
  expect(stampUpdate.ok()).toBeTruthy();

  const existingCard = await page.request.post("/api/scan", {
    headers: { origin },
    data: { token: firstToken },
  });
  expect(existingCard.ok()).toBeTruthy();
  await expect(existingCard.json()).resolves.toMatchObject({
    balance: 1,
    mode: "STAMPS",
    threshold: 5,
    rewardLabel: "Cookie offert",
  });

  const pointsUpdate = await page.request.patch("/api/program", {
    headers: { origin },
    data: {
      programName: "Carte points",
      mode: "POINTS",
      pointsRule: "PER_PURCHASE",
      rewardThreshold: 20,
      rewardLabel: "Boisson offerte",
      cardMessage: null,
      stampsPerVisit: 1,
      pointsPerPurchase: 7,
      pointsPerEuro: 1,
      dailyEarnLimit: 0,
      cooldownSeconds: 120,
      expiresAfterDays: null,
    },
  });
  expect(pointsUpdate.ok()).toBeTruthy();

  await page.goto("/dashboard");
  const second = await enrollCustomer(page, "Client points", `${unique("points-card")}@example.com`);
  const secondToken = second.cardUrl.split("/c/")[1];
  const pointsCredit = await page.request.post("/api/credit", {
    headers: { origin },
    data: { token: secondToken, idempotencyKey: crypto.randomUUID() },
  });
  expect(pointsCredit.ok()).toBeTruthy();
  await expect(pointsCredit.json()).resolves.toMatchObject({
    balance: 7,
    delta: 7,
    mode: "POINTS",
    threshold: 20,
    rewardLabel: "Boisson offerte",
  });
});
