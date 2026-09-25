import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { origin, randomizeClientIp, submitSignupAndVerify, testClientIp, unique } from "./helpers";

// Parcours complet de bout en bout : plusieurs compilations à froid en dev.
test.setTimeout(90_000);

async function savedStep(slug: string) {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const [row] = await sql`select onboarding_step from establishments where slug=${slug}`;
    return Number(row.onboarding_step);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function heading(page: Page, text: string) {
  await expect(page.getByRole("heading", { name: text })).toBeVisible();
}

test("onboarding séquentiel : enchaînement, retour, double clic, deux onglets et écran « Tout est prêt »", async ({ page, context }) => {
  const marker = unique("sequential");
  await randomizeClientIp(page);
  await page.goto("/signup");
  await page.getByLabel("Nom du commerce").fill(`Commerce ${marker}`);
  await page.getByLabel("Email", { exact: true }).fill(`${marker}@example.com`);
  await page.getByLabel("Mot de passe", { exact: true }).fill("Password-test-123!");
  await submitSignupAndVerify(page, `${marker}@example.com`, "Password-test-123!");
  const { slug } = await page.request.get("/api/restaurant").then((response) => response.json());

  // L'écran final n'existe pas tant que l'étape 4 n'est pas enregistrée.
  await page.goto("/onboarding/ready");
  await expect(page).toHaveURL(/\/onboarding$/);

  // Étape 1 → 2 automatiquement, seulement après la sauvegarde serveur.
  await heading(page, "Étape 1 sur 4 · Commerce");
  await expect(page.getByRole("link", { name: /Étape précédente/ })).toHaveCount(0);
  await page.getByLabel("Nom", { exact: true }).fill("Café des Halles");
  await page.getByRole("button", { name: "Enregistrer et continuer" }).click();
  await heading(page, "Étape 2 sur 4 · Programme");
  expect(await savedStep(slug)).toBe(2);

  // Étape 2 : double clic sans double progression ni double écriture visible.
  await page.getByLabel("Récompense", { exact: true }).fill("Un café offert");
  const saveProgram = page.getByRole("button", { name: "Enregistrer et continuer" });
  await saveProgram.dblclick();
  await heading(page, "Étape 3 sur 4 · Équipe");
  expect(await savedStep(slug)).toBe(3);

  // Retour arrière : les valeurs enregistrées sont intactes.
  await page.getByRole("link", { name: "← Étape précédente : Programme" }).click();
  await heading(page, "Étape 2 sur 4 · Programme");
  await expect(page.getByLabel("Récompense", { exact: true })).toHaveValue("Un café offert");
  await page.getByRole("link", { name: "← Étape précédente : Commerce" }).click();
  await expect(page.getByLabel("Nom", { exact: true })).toHaveValue("Café des Halles");
  expect(await savedStep(slug)).toBe(3);

  // Reprise au dernier step enregistré.
  await page.goto("/onboarding");
  await heading(page, "Étape 3 sur 4 · Équipe");

  // Deux onglets : l'onglet en retard ne fait ni reculer ni échouer la progression.
  const second = await context.newPage();
  await second.goto("/onboarding");
  await heading(second, "Étape 3 sur 4 · Équipe");
  await page.getByRole("button", { name: "Je travaille seul pour le moment" }).click();
  await heading(page, "Étape 4 sur 4 · QR d’inscription");
  await second.getByRole("button", { name: "Je travaille seul pour le moment" }).click();
  await heading(second, "Étape 4 sur 4 · QR d’inscription");
  expect(await savedStep(slug)).toBe(4);
  await second.close();

  // Étape 4 → écran final.
  await page.getByRole("button", { name: "Terminer la configuration" }).click();
  await expect(page).toHaveURL(/\/onboarding\/ready$/);
  await heading(page, "Tout est prêt");
  expect(await savedStep(slug)).toBe(5);
  const path = page.getByRole("list", { name: "Parcours recommandé" }).getByRole("listitem");
  await expect(path).toHaveCount(6);
  await expect(path.nth(0)).toContainText("Ouvrir l’inscription client");
  await expect(path.nth(1)).toContainText("Créer une carte test");
  await expect(path.nth(2)).toContainText("Ouvrir le scanner");
  await expect(path.nth(3)).toContainText("Scanner la carte");
  await expect(path.nth(4)).toContainText("Ajouter le premier tampon / crédit");
  await expect(path.nth(5)).toContainText("Aller au dashboard");
  await expect(page.getByLabel("fait")).toHaveCount(0);
  const joinHref = await page.getByRole("link", { name: "Ouvrir l’inscription client" }).getAttribute("href");
  expect(joinHref).toBe(`${origin}/j/${slug}`);
  await expect(page.getByRole("link", { name: "Ouvrir le scanner" })).toHaveAttribute("href", "/s");

  // Suivre le parcours : carte test puis premier crédit, cochés d'après la base.
  const customer = await context.newPage();
  await customer.goto(joinHref!);
  await customer.getByLabel(/Prénom/).fill("Test");
  await customer.getByLabel(/Email/).fill(`${unique("sequential-card")}@example.com`);
  await customer.getByRole("button", { name: "Créer ma carte" }).click();
  await expect(customer).toHaveURL(/\/c\//, { timeout: 15_000 });
  const shortCode = (await customer.locator("img[alt='QR code fidélité'] + strong").textContent())!.trim();
  await customer.close();
  await page.reload();
  await expect(page.getByLabel("fait")).toHaveCount(1);

  await page.getByRole("link", { name: "Ouvrir le scanner" }).click();
  await page.getByPlaceholder("Code court ou email").fill(shortCode);
  await page.getByRole("button", { name: "Chercher" }).click();
  await page.getByRole("button", { name: "+1 tampon" }).click();
  await expect(page.getByText("+1 validé")).toBeVisible();
  await page.goto("/onboarding/ready");
  await expect(page.getByLabel("fait")).toHaveCount(2);

  await page.getByRole("link", { name: "Aller au dashboard" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/dashboard$/);

  // Un « terminer » tardif (onglet oublié) ne rembobine rien.
  expect((await page.request.post("/api/onboarding", { headers: { origin }, data: { action: "finish" } })).ok()).toBeTruthy();
  expect(await savedStep(slug)).toBe(5);
});

test("écran « Tout est prêt » réservé au propriétaire", async ({ page, browser }) => {
  const marker = unique("ready-owner");
  await randomizeClientIp(page);
  await page.goto("/signup");
  await page.getByLabel("Nom du commerce").fill(`Commerce ${marker}`);
  await page.getByLabel("Email", { exact: true }).fill(`${marker}@example.com`);
  await page.getByLabel("Mot de passe", { exact: true }).fill("Password-test-123!");
  await submitSignupAndVerify(page, `${marker}@example.com`, "Password-test-123!");
  const employeeEmail = `${unique("ready-employee")}@example.com`;
  expect((await page.request.post("/api/employees", { headers: { origin }, data: { email: employeeEmail, password: "Password-test-123!", role: "EMPLOYEE" } })).ok()).toBeTruthy();
  const employeeContext = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": testClientIp() } });
  const employee = await employeeContext.newPage();
  try {
    await employee.goto(`${origin}/login`);
    await employee.getByLabel("Email").fill(employeeEmail);
    await employee.getByLabel("Mot de passe").fill("Password-test-123!");
    await employee.getByRole("button", { name: "Se connecter" }).click();
    await expect(employee).toHaveURL(/\/s$/);
    await employee.goto(`${origin}/onboarding/ready`);
    await expect(employee).toHaveURL(/\/s$/);
  } finally {
    await employeeContext.close();
  }
});
