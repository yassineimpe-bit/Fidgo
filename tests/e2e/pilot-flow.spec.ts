import { expect, type Page, test } from "@playwright/test";

const origin = "http://127.0.0.1:3000";

function unique(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createMerchant(page: Page, label: string) {
  const marker = unique(label);
  await page.goto("/signup");
  await page.getByLabel("Nom du commerce").fill(`Commerce ${marker}`);
  await page.getByLabel("Email").fill(`${marker}@example.com`);
  await page.getByLabel("Mot de passe").fill("Password-test-123!");
  await page.getByRole("button", { name: "Créer mon espace" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function enrollCustomer(page: Page, firstName: string, email: string) {
  const joinPath = await page.locator("code").filter({ hasText: "/j/" }).textContent();
  expect(joinPath).toMatch(/^\/j\//);
  await page.goto(joinPath!);
  await page.getByLabel(/Prénom/).fill(firstName);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Créer ma carte" }).click();
  await expect(page).toHaveURL(/\/c\//);
  const cardUrl = page.url();
  const shortCode = (await page.locator("img[alt='QR code fidélité'] + strong").textContent())?.trim();
  expect(shortCode).toMatch(/^[A-Z0-9]{6}$/);
  return { cardUrl, shortCode: shortCode! };
}

async function openCardInScanner(page: Page, shortCode: string) {
  await page.goto("/s");
  await page.getByPlaceholder("Code court ou email").fill(shortCode);
  await page.getByRole("button", { name: "Chercher" }).click();
  await expect(page.getByText(/\d+ \/ 10 tampons/)).toBeVisible();
}

test("boucle pilote : inscription, crédit, override, auto-refresh et récompense", async ({ page }) => {
  const customerEmail = `${unique("client")}@example.com`;
  await createMerchant(page, "boucle");
  const { cardUrl, shortCode } = await enrollCustomer(page, "Camille", customerEmail);

  const cardPage = await page.context().newPage();
  const pollingUrls: string[] = [];
  cardPage.on("request", (request) => {
    if (request.url().includes("/api/card/")) pollingUrls.push(request.url());
  });
  await cardPage.goto(cardUrl);
  await expect(cardPage.getByText("0 / 10")).toBeVisible();

  await openCardInScanner(page, shortCode);
  await page.getByRole("button", { name: "+1 tampon" }).click();
  await expect(page.getByText("+1 validé")).toBeVisible();
  await expect(cardPage.getByText("1 / 10")).toBeVisible({ timeout: 8_000 });

  const token = cardUrl.split("/c/")[1];
  expect(pollingUrls.some((url) => new URL(url).pathname === "/api/card/status")).toBeTruthy();
  expect(pollingUrls.every((url) => !url.includes(token))).toBeTruthy();

  await page.waitForTimeout(1_400);
  await openCardInScanner(page, shortCode);
  await page.getByRole("button", { name: "+1 tampon" }).click();
  await expect(page.getByText(/Passage déjà enregistré/)).toBeVisible();
  await page.getByLabel("Motif obligatoire pour créditer quand même").fill("Second achat distinct");
  await page.getByRole("button", { name: "Créditer quand même" }).click();
  await expect(page.getByText("+1 validé")).toBeVisible();
  await expect(cardPage.getByText("2 / 10")).toBeVisible({ timeout: 8_000 });

  await page.goto("/dashboard/clients");
  const exportHref = await page.getByRole("link", { name: "Exporter" }).getAttribute("href");
  const customerId = exportHref?.match(/\/api\/customers\/([^/]+)\/export/)?.[1];
  expect(customerId).toBeTruthy();
  const adjustment = await page.request.post(`/api/customers/${customerId}/adjust`, {
    headers: { origin },
    data: { newBalance: 10, reason: "Préparation test récompense", idempotencyKey: crypto.randomUUID() },
  });
  expect(adjustment.ok()).toBeTruthy();
  await expect(cardPage.getByText("10 / 10")).toBeVisible({ timeout: 8_000 });

  await openCardInScanner(page, shortCode);
  await expect(page.getByText(/Récompense disponible/)).toBeVisible();
  await page.getByRole("button", { name: "Utiliser récompense" }).click();
  await expect(page.getByText(/utilisée/)).toBeVisible();
  await expect(cardPage.getByText("0 / 10")).toBeVisible({ timeout: 8_000 });
});

test("récompense : une carte client ne peut pas consommer sans session staff", async ({ page, request }) => {
  await createMerchant(page, "redeem-auth");
  const { cardUrl } = await enrollCustomer(page, "Lina", `${unique("redeem-client")}@example.com`);
  const token = cardUrl.split("/c/")[1];

  const response = await request.post("/api/redeem", {
    headers: { origin },
    data: { token, idempotencyKey: crypto.randomUUID() },
  });
  expect(response.status()).toBe(401);
});

test("isolation tenant : un commerce ne retrouve pas la carte d’un autre", async ({ browser }) => {
  const first = await browser.newContext();
  const second = await browser.newContext();
  const firstPage = await first.newPage();
  const secondPage = await second.newPage();

  try {
    await createMerchant(firstPage, "tenant-a");
    await createMerchant(secondPage, "tenant-b");
    const foreignEmail = `${unique("foreign")}@example.com`;
    const foreignCard = await enrollCustomer(secondPage, "Noah", foreignEmail);
    const foreignToken = foreignCard.cardUrl.split("/c/")[1];

    const scan = await firstPage.request.post("/api/scan", {
      headers: { origin },
      data: { token: `LOY1:${foreignToken}` },
    });
    expect(scan.status()).toBe(404);
    await expect(scan.json()).resolves.toMatchObject({ error: "CARD_NOT_FOUND" });

    const lookup = await firstPage.request.get(`/api/lookup?q=${encodeURIComponent(foreignEmail)}`);
    expect(lookup.status()).toBe(404);
  } finally {
    await first.close();
    await second.close();
  }
});
