import { expect, type Page } from "@playwright/test";

export const origin = "http://127.0.0.1:3000";

export function unique(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function testClientIp() {
  // Les E2E tournent tous derrière 127.0.0.1. Sans IP logique distincte,
  // les retries Playwright consomment le même bucket de rate-limit signup et
  // un test ultérieur peut recevoir 429 alors que l'application fonctionne.
  // 2001:db8::/32 est réservé à la documentation et ne sort jamais d'ici.
  return `2001:db8::${Math.floor(Math.random() * 0xffff).toString(16)}`;
}

export async function randomizeClientIp(page: Page) {
  await page.setExtraHTTPHeaders({ "x-real-ip": testClientIp() });
}

export async function createMerchant(page: Page, label: string) {
  const marker = unique(label);
  const email = `${marker}@example.com`;
  const password = "Password-test-123!";
  await randomizeClientIp(page);
  await page.goto("/signup");
  await page.getByLabel("Nom du commerce").fill(`Commerce ${marker}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill(password);

  const signupResponsePromise = page.waitForResponse(
    (response) => response.url().endsWith("/api/auth/signup") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Créer mon espace" }).click();
  const signupResponse = await signupResponsePromise;
  expect(signupResponse.status()).toBe(202);
  const signup = await signupResponse.json() as { verificationToken?: string };
  expect(signup.verificationToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

  const verified = await page.request.post("/api/auth/verify-email", {
    headers: { origin },
    data: { token: signup.verificationToken },
  });
  expect(verified.ok()).toBeTruthy();

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
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

/**
 * En dessous de 820px, Déconnexion se trouve dans le menu mobile (voir
 * mobile-nav-menu.tsx) plutôt que directement dans l'en-tête.
 */
export async function logout(page: Page) {
  const directLogout = page.getByRole("button", { name: "Déconnexion" });
  const menuToggle = page.getByRole("button", { name: "Ouvrir le menu" });
  if (await menuToggle.isVisible().catch(() => false)) await menuToggle.click();
  await directLogout.click();
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
