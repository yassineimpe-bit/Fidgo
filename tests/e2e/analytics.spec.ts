import { expect, test } from "@playwright/test";
import { createMerchant, currentCustomerId, enrollCustomer, origin, unique } from "./helpers";

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


test("dashboard : scans du jour et récompenses disponibles reflètent l'activité réelle", async ({ page }) => {
  await createMerchant(page, "dashboard-pilot-metrics");
  const enrolled = await enrollCustomer(page, "Métriques", `${unique("metrics-client")}@example.com`);
  const token = enrolled.cardUrl.split("/c/")[1];

  const customerId = await currentCustomerId(page);

  const program = await page.request.get("/api/program").then((response) => response.json());
  const adjusted = await page.request.post(`/api/customers/${customerId}/adjust`, {
    headers: { origin },
    data: {
      newBalance: Number(program.reward_threshold),
      reason: "Préparation métrique dashboard",
      idempotencyKey: crypto.randomUUID(),
    },
  });
  expect(adjusted.ok()).toBeTruthy();

  const scanEvent = await page.request.post("/api/events", {
    headers: { origin },
    data: { eventType: "SCAN_SUCCESS", durationMs: 120, source: "qr" },
  });
  expect(scanEvent.status()).toBe(202);

  await page.goto("/dashboard");
  await expect(page.locator(".metric", { hasText: "scans du jour" }).locator("strong")).toHaveText("1");
  await expect(page.locator(".metric", { hasText: "récompenses disponibles" }).locator("strong")).toHaveText("1");

  const scanned = await page.request.post("/api/scan", {
    headers: { origin },
    data: { token },
  });
  expect(scanned.ok()).toBeTruthy();
  await expect(scanned.json()).resolves.toMatchObject({ rewardAvailable: true });
});
