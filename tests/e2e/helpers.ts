import { expect, type Page } from "@playwright/test";

export const origin = "http://127.0.0.1:3000";

export function unique(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Toutes les requêtes de test partagent la même IP loopback locale. Sans
 * ceci, `/api/auth/signup` (limité à 5/h/IP) bloque dès que plusieurs specs
 * créent des commerçants dans la même exécution, avant même que la limite
 * ait quoi que ce soit à voir avec le comportement testé. Chaque contexte de
 * test simule donc sa propre IP, comme des visiteurs réels distincts.
 */
export async function randomizeClientIp(page: Page) {
  const ip = `10.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}`;
  await page.context().setExtraHTTPHeaders({ "x-real-ip": ip });
}

export async function createMerchant(page: Page, label: string) {
  const marker = unique(label);
  await randomizeClientIp(page);
  await page.goto("/signup");
  await page.getByLabel("Nom du commerce").fill(`Commerce ${marker}`);
  await page.getByLabel("Email").fill(`${marker}@example.com`);
  await page.getByLabel("Mot de passe").fill("Password-test-123!");
  await page.getByRole("button", { name: "Créer mon espace" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

export async function enrollCustomer(page: Page, firstName: string, email: string) {
  const joinPath = await page.locator("code").filter({ hasText: "/j/" }).textContent();
  expect(joinPath).toMatch(/^\/j\//);
  await page.goto(joinPath!);
  await page.getByLabel(/Prénom/).fill(firstName);
  await page.getByLabel(/Email/).fill(email);
  await page.getByRole("button", { name: "Créer ma carte" }).click();
  await expect(page).toHaveURL(/\/c\//);
  const cardUrl = page.url();
  const shortCode = (await page.locator("img[alt='QR code fidélité'] + strong").textContent())?.trim();
  expect(shortCode).toMatch(/^[A-Z0-9]{6}$/);
  return { cardUrl, shortCode: shortCode! };
}

export async function openCardInScanner(page: Page, shortCode: string) {
  await page.goto("/s");
  await page.getByPlaceholder("Code court ou email").fill(shortCode);
  await page.getByRole("button", { name: "Chercher" }).click();
  await expect(page.getByText(/\d+ \/ 10 tampons/)).toBeVisible();
}

/** Récupère l'id du client courant depuis le lien "Exporter" de /dashboard/clients. */
export async function currentCustomerId(page: Page) {
  await page.goto("/dashboard/clients");
  const exportHref = await page.getByRole("link", { name: "Exporter" }).getAttribute("href");
  const customerId = exportHref?.match(/\/api\/customers\/([^/]+)\/export/)?.[1];
  expect(customerId).toBeTruthy();
  return customerId!;
}
