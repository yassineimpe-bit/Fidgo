import { expect, test } from "@playwright/test";
import { createMerchant } from "./helpers";

test("stats pilote : 30 actions calculent réellement le p50, le p95 et le maximum", async ({ page }) => {
  await createMerchant(page, "scan-stats");

  const metrics = Array.from({ length: 30 }, (_, index) => ({
    phase: "action" as const,
    action: "credit" as const,
    networkMs: 300 + index,
    serverMs: 100 + index,
    totalMs: 1_000 + index * 10,
    ok: true,
    at: new Date(Date.now() + index).toISOString(),
  }));
  metrics.push({
    phase: "action",
    action: "credit",
    networkMs: 9_999,
    serverMs: 9_999,
    totalMs: 9_999,
    ok: false,
    at: new Date().toISOString(),
  });

  await page.evaluate((storedMetrics) => {
    localStorage.setItem("loyalty_scan_metrics", JSON.stringify(storedMetrics));
  }, metrics);
  await page.goto("/s/stats");

  await expect(page.locator(".metric", { hasText: "actions validées" }).locator("strong")).toHaveText("30");
  await expect(page.locator(".metric", { hasText: "p50 détection" }).locator("strong")).toHaveText("1140 ms");
  await expect(page.locator(".metric", { hasText: "p95 détection" }).locator("strong")).toHaveText("1280 ms");
  await expect(page.locator(".metric", { hasText: "max" }).locator("strong")).toHaveText("1290 ms");
  await expect(page.locator(".metric", { hasText: "p95 réseau" }).locator("strong")).toHaveText("328 ms");
  await expect(page.locator(".metric", { hasText: "p95 serveur" }).locator("strong")).toHaveText("128 ms");

  await page.getByRole("button", { name: "Effacer les mesures" }).click();
  await expect(page.locator(".metric", { hasText: "actions validées" }).locator("strong")).toHaveText("0");
});
