import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { origin, randomizeClientIp, submitSignupAndVerify, unique } from "./helpers";

// Inscription + compilation à la demande des trois étapes.
test.describe.configure({ timeout: 90_000 });

async function signup(page: Page, label: string) {
  const marker = unique(label);
  await randomizeClientIp(page);
  await page.goto("/signup");
  await page.getByLabel("Nom du commerce").fill(`Commerce ${marker}`);
  await page.getByLabel("Email", { exact: true }).fill(`${marker}@example.com`);
  await page.getByLabel("Mot de passe", { exact: true }).fill("Password-test-123!");
  await submitSignupAndVerify(page, `${marker}@example.com`, "Password-test-123!");
  return page.request.get("/api/restaurant").then((response) => response.json()) as Promise<{ id: string; slug: string }>;
}

async function setSavedStep(id: string, step: number) {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`update establishments set onboarding_step=${step} where id=${id}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("chemin critique : QR atteint sans employé ni champ facultatif, réglages différés accessibles ensuite", async ({ page }) => {
  await signup(page, "critical-path");
  await expect(page.getByRole("heading", { name: "Étape 1 sur 3 · Commerce" })).toBeVisible();
  // Champs facultatifs repliés : aucun ne bloque l'étape.
  const optional = page.locator("details.optional-settings");
  await expect(optional).not.toHaveAttribute("open", "");
  await expect(page.getByLabel("Adresse", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Enregistrer et continuer" }).click();
  await expect(page.getByRole("heading", { name: "Étape 2 sur 3 · Programme" })).toBeVisible();
  await page.getByRole("button", { name: "Enregistrer et continuer" }).click();
  await expect(page.getByRole("heading", { name: "Étape 3 sur 3 · QR d’inscription" })).toBeVisible();
  await expect(page.getByRole("img", { name: "QR d'inscription" })).toBeVisible();
  await expect(page.getByText(/Équipe|employé/i).first()).toBeVisible();
  await expect(page.getByLabel("Email de l’employé")).toHaveCount(0);

  await page.getByRole("button", { name: "Terminer la configuration" }).click();
  await expect(page).toHaveURL(/\/onboarding\/ready$/, { timeout: 15_000 });
  // Aucune durée présentée comme garantie.
  await expect(page.locator("main")).not.toContainText(/minutes?/);
  const later = page.getByRole("region", { name: "Ensuite, quand tu veux" });
  await expect(later.getByRole("link", { name: "Ajouter un employé" })).toHaveAttribute("href", "/dashboard/employees");
  await expect(later.getByRole("link", { name: "Compléter ton commerce" })).toHaveAttribute("href", "/dashboard/settings");

  await page.goto("/dashboard");
  await expect(page.getByRole("link", { name: "○ Ajouter un employé (facultatif)" })).toHaveAttribute("href", "/dashboard/employees");
  // Les réglages déplacés restent intacts et modifiables.
  await page.goto("/dashboard/settings");
  await expect(page.getByLabel("Adresse", { exact: true })).toBeVisible();
  await expect(page.getByLabel("URL du logo")).toBeVisible();
});

test("onboarding commencé avant #151 : l'ancienne étape 3 ou 4 reprend directement sur le QR", async ({ page }) => {
  const restaurant = await signup(page, "legacy-step");
  for (const legacy of [3, 4]) {
    await setSavedStep(restaurant.id, legacy);
    await page.goto("/onboarding");
    await expect(page.getByRole("heading", { name: "Étape 3 sur 3 · QR d’inscription" })).toBeVisible();
    await page.goto("/onboarding?step=4");
    await expect(page.getByRole("heading", { name: "Étape 3 sur 3 · QR d’inscription" })).toBeVisible();
  }
  const finished = await page.request.post("/api/onboarding", { headers: { origin }, data: { action: "finish" } });
  expect(await finished.json()).toMatchObject({ ok: true, step: 5 });
});

test("les trois étapes restent lisibles à 320 / 390 / 430 px", async ({ page }) => {
  await signup(page, "critical-mobile");
  for (const [index, heading] of ["Étape 1 sur 3 · Commerce", "Étape 2 sur 3 · Programme", "Étape 3 sur 3 · QR d’inscription"].entries()) {
    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 720 });
      await page.goto(`/onboarding?step=${index + 1}`);
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      expect(await noOverflow(page), `${heading} @${width}px`).toBe(0);
    }
    if (index < 2) {
      await page.getByRole("button", { name: "Enregistrer et continuer" }).click();
      await expect(page.getByRole("heading", { name: `Étape ${index + 2} sur 3`, exact: false })).toBeVisible();
    }
  }
});
