import { expect, test } from "@playwright/test";
import { createMerchant, origin, randomizeClientIp, unique } from "./helpers";

test("sécurité compte : changement de mot de passe révoque la session et remplace l'ancien secret", async ({ page }) => {
  const email = `${unique("change-password")}@example.com`;
  const oldPassword = "Password-test-123!";
  const newPassword = "Fresh-Password-987!";

  await randomizeClientIp(page);
  await page.goto("/signup");
  await page.getByLabel("Nom du commerce").fill("Commerce changement mot de passe");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill(oldPassword);
  await page.getByRole("button", { name: "Créer mon espace" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/dashboard/security");
  await page.getByLabel("Mot de passe actuel").fill(oldPassword);
  await page.getByLabel("Nouveau mot de passe", { exact: true }).fill(newPassword);
  await page.getByLabel("Confirmer le nouveau mot de passe").fill(newPassword);
  await page.getByRole("button", { name: "Modifier le mot de passe" }).click();
  await expect(page.getByText(/sessions ont été révoquées/i)).toBeVisible();
  await expect(page).toHaveURL(/\/login$/, { timeout: 5000 });

  const oldLogin = await page.request.post("/api/auth/login", {
    headers: { origin },
    data: { email, password: oldPassword },
  });
  expect(oldLogin.status()).toBe(401);

  const newLogin = await page.request.post("/api/auth/login", {
    headers: { origin },
    data: { email, password: newPassword },
  });
  expect(newLogin.status()).toBe(200);
});

test("sécurité compte : mot de passe actuel incorrect et réutilisation sont refusés", async ({ page }) => {
  await createMerchant(page, "change-password-errors");

  const wrong = await page.request.post("/api/auth/change-password", {
    headers: { origin },
    data: { currentPassword: "Wrong-password-123!", newPassword: "Fresh-Password-987!" },
  });
  expect(wrong.status()).toBe(401);
  expect(await wrong.json()).toEqual({ error: "INVALID_CURRENT_PASSWORD" });

  const same = await page.request.post("/api/auth/change-password", {
    headers: { origin },
    data: { currentPassword: "Password-test-123!", newPassword: "Password-test-123!" },
  });
  expect(same.status()).toBe(409);
  expect(await same.json()).toEqual({ error: "SAME_PASSWORD" });
});
