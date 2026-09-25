import { expect, test } from "@playwright/test";
import { BILLING_PLANS, BILLING_TRIAL_DAYS } from "../../lib/billing-plans";

test("site commercial : parcours, fidélité, QR, Wallet, prix et appel à l'essai", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Retiko — carte de fidélité QR pour restaurants et commerces");
  for (const heading of [
    "De l’affiche à la récompense, en quatre gestes",
    "Tampons ou points, à votre image",
    "Un QR pour s’inscrire, un QR par client",
    "La carte dans le téléphone, pas dans le portefeuille",
    "Un abonnement, tout compris",
    "Prêt pour le prochain rush ?",
  ]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  await expect(page.locator(".landing-steps li")).toHaveCount(4);
  await expect(page.getByRole("img", { name: "QR code d’essai Retiko" })).toBeVisible();

  // Les prix affichés sont ceux facturés (source unique lib/billing-plans).
  const plans = page.locator(".landing-plan");
  await expect(plans).toHaveCount(3);
  for (const plan of Object.values(BILLING_PLANS)) {
    await expect(plans.filter({ hasText: plan.label })).toContainText(plan.priceLabel);
  }
  await expect(page.getByText(`${BILLING_TRIAL_DAYS} jours d’essai gratuit`)).toBeVisible();

  const cta = page.getByRole("link", { name: `Essayer gratuitement ${BILLING_TRIAL_DAYS} jours` });
  await expect(cta).toHaveCount(2);
  await cta.first().click();
  await expect(page).toHaveURL(/\/signup$/);
});

test("site commercial : SEO de base et aucune page privée indexable", async ({ page, request }) => {
  const response = await page.goto("/");
  expect(response?.headers()["x-robots-tag"]).toBeUndefined();
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /Essai gratuit 30 jours/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /^https?:\/\/[^/]+\/?$/);
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", /Retiko/);
  const jsonLd = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent())!);
  expect(jsonLd).toMatchObject({ "@type": "SoftwareApplication", name: "Retiko" });
  expect(jsonLd.offers).toHaveLength(3);

  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Allow: /");
  for (const privatePath of ["/api/", "/c/", "/dashboard", "/admin", "/recover", "/reset-password"]) {
    expect(robots).toContain(`Disallow: ${privatePath}`);
  }
  expect(robots).toMatch(/Sitemap: .*\/sitemap\.xml/);

  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).toContain("/signup</loc>");
  expect(sitemap).toContain("/legal/cgv</loc>");
  expect(sitemap).not.toContain("/dashboard");
  expect(sitemap).not.toContain("/c/");

  // Mobile : aucune barre de défilement horizontale.
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
});
