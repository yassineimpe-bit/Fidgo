import { expect, test } from "@playwright/test";
import { createMerchant, origin, unique } from "./helpers";

test.describe.configure({ timeout: 90_000 });

test("inscription client : l'email vient en premier, prénom et téléphone restent facultatifs", async ({ page }) => {
  await createMerchant(page, "join-order");
  const joinPath = await page.locator("code").filter({ hasText: "/j/" }).textContent();
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 720 });
    await page.goto(joinPath!);
    const fields = page.locator("form.form input:not([type=checkbox])");
    await expect(fields.nth(0)).toHaveAttribute("id", "join-email");
    await expect(page.getByLabel("Email")).toHaveAttribute("required", "");
    await expect(page.getByLabel(/Prénom/)).not.toHaveAttribute("required", "");
    await expect(page.getByLabel(/Téléphone/)).not.toHaveAttribute("required", "");
    await expect(page.getByRole("checkbox")).not.toBeChecked();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  }
  // Inscription avec l'email seul : aucun champ facultatif n'est exigé.
  await page.getByLabel("Email").fill(`${unique("join-order-client")}@example.com`);
  await page.getByRole("button", { name: "Créer ma carte" }).click();
  await expect(page).toHaveURL(/\/c\//, { timeout: 15_000 });
});

test("équipe : erreurs traduites, jamais de code brut, aide courte sur les rôles", async ({ page }) => {
  await createMerchant(page, "team-copy");
  await page.goto("/dashboard/employees");
  const help = page.locator("#employee-role-help");
  await expect(help).toContainText("Manager");
  await expect(help).toContainText("Employé : utilise uniquement le scanner en caisse.");
  await expect(help).toContainText("Lecture seule");

  const email = `${unique("team-copy-staff")}@example.com`;
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe temporaire").fill("Password-test-123!");
  await page.getByRole("button", { name: "Créer l’accès" }).click();
  await expect(page.locator(".notice[role=status]")).toHaveText("Accès créé.");

  // Erreur connue : email déjà utilisé.
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe temporaire").fill("Password-test-123!");
  await page.getByRole("button", { name: "Créer l’accès" }).click();
  const alert = page.locator(".notice[role=alert]");
  await expect(alert).toHaveText("Cet email est déjà utilisé par un autre accès. Choisis une autre adresse.");
  await expect(alert).not.toContainText("EMAIL_ALREADY_USED");

  // Erreur inconnue du serveur : message générique, aucun code technique.
  await page.route("**/api/employees", (route) => route.fulfill({ status: 500, json: { error: "STAFF_CREATE_FAILED" } }));
  await page.getByLabel("Email").fill(`${unique("team-copy-other")}@example.com`);
  await page.getByLabel("Mot de passe temporaire").fill("Password-test-123!");
  await page.getByRole("button", { name: "Créer l’accès" }).click();
  await expect(alert).toHaveText("L’action n’a pas pu être enregistrée. Réessaie dans un instant.");
  await expect(page.locator("main")).not.toContainText("STAFF_CREATE_FAILED");

  // Permissions inchangées : le propriétaire peut toujours créer un manager.
  await page.unroute("**/api/employees");
  expect((await page.request.post("/api/employees", { headers: { origin }, data: { email: `${unique("team-copy-mgr")}@example.com`, password: "Password-test-123!", role: "MANAGER" } })).status()).toBe(201);
});
