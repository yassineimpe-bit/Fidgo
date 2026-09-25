import { expect, test } from "@playwright/test";
import { createMerchant, enrollCustomer, openCardInScanner, origin, unique } from "./helpers";

test("libellé d'unité : « café » sur le programme, le scanner, la carte et l'inscription", async ({ page }) => {
  test.setTimeout(90_000);
  await createMerchant(page, "unit-label");

  await page.goto("/dashboard/program");
  await page.getByLabel("Nom de l’unité").fill("Café");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByText("Programme enregistré.")).toBeVisible();
  const program = await page.request.get("/api/program").then((response) => response.json());
  expect(program).toMatchObject({ unit_label: "café", unit_label_plural: null });

  // Libellés refusés : balise, chiffres, pluriel sans singulier.
  for (const data of [{ unitLabel: "<b>x</b>" }, { unitLabel: "2 cafés" }, { unitLabel: "", unitLabelPlural: "cafés" }]) {
    const refused = await page.request.patch("/api/program", {
      headers: { origin },
      data: { mode: program.mode, pointsRule: program.points_rule, rewardThreshold: program.reward_threshold, rewardLabel: program.reward_label, stampsPerVisit: program.stamps_per_visit, pointsPerPurchase: program.points_per_purchase, pointsPerEuro: Number(program.points_per_euro), dailyEarnLimit: program.daily_earn_limit, cooldownSeconds: program.cooldown_seconds, expiresAfterDays: null, ...data },
    });
    expect(refused.status()).toBe(400);
    expect(await refused.json()).toEqual({ error: "INVALID_UNIT_LABEL" });
  }

  await page.goto("/dashboard");
  const { cardUrl, shortCode } = await enrollCustomer(page, "Lina", `${unique("unit-label")}@example.com`);
  await expect(page.getByText(/Encore 10 cafés avant votre récompense/)).toBeVisible();

  await page.goto("/s");
  await page.getByPlaceholder("Code court ou email").fill(shortCode);
  await page.getByRole("button", { name: "Chercher" }).click();
  await expect(page.getByText("0 / 10 cafés")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "+1 café" }).click();
  await expect(page.getByText("+1 validé")).toBeVisible({ timeout: 15_000 });

  await page.goto(cardUrl);
  await expect(page.getByText(/Encore 9 cafés avant votre récompense/)).toBeVisible();

  const slug = (await page.request.get("/api/restaurant").then((response) => response.json())).slug;
  await page.goto(`/j/${slug}`);
  await expect(page.getByText("Carte à cafés")).toBeVisible();

  // Retour au libellé par défaut : champ vidé.
  await page.goto("/dashboard/program");
  await page.getByLabel("Nom de l’unité").fill("");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByText("Programme enregistré.")).toBeVisible();
  await openCardInScanner(page, shortCode);
  await expect(page.getByRole("button", { name: "+1 tampon" })).toBeVisible();
});
