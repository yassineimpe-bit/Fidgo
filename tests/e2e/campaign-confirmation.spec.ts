import { expect, test, type Page, type Request } from "@playwright/test";
import { createMerchant, origin, testClientIp, unique } from "./helpers";

test.describe.configure({ timeout: 90_000 });

async function merchantWithSubscribers(page: Page, label: string, count: number) {
  await createMerchant(page, label);
  const slug = String((await page.request.get("/api/restaurant").then((response) => response.json())).slug);
  for (let index = 0; index < count; index += 1) {
    const response = await page.request.post("/api/enroll", {
      headers: { origin, "x-real-ip": testClientIp() },
      data: { slug, firstName: `Client${index}`, email: `${unique(`${label}-${index}`)}@example.com`, marketingConsent: true },
    });
    expect(response.status()).toBe(201);
  }
  return slug;
}

function watchCampaignCreation(page: Page) {
  const requests: Request[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/campaigns") requests.push(request);
  });
  return requests;
}

async function compose(page: Page, subject: string) {
  await page.goto("/dashboard/campaigns");
  await expect(page.getByText(/client\(s\) recevront cet e-mail\./)).toBeVisible({ timeout: 15_000 });
  await page.getByLabel("Objet").fill(subject);
  await page.getByLabel("Message").fill("Bonjour, un café vous attend.");
}

const dialog = (page: Page) => page.getByRole("dialog", { name: "Confirmer l’envoi de la campagne ?" });

test("campagne : récapitulatif avant envoi, Annuler et Échap sans création, confirmation explicite", async ({ page }) => {
  await merchantWithSubscribers(page, "campaign-confirm", 2);
  const created = watchCampaignCreation(page);
  let nativeDialogs = 0;
  page.on("dialog", (native) => { nativeDialogs += 1; void native.dismiss(); });
  await compose(page, "Café offert cette semaine");

  await page.getByRole("button", { name: "Envoyer à 2 client(s)" }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Confirmer l’envoi de la campagne ?" })).toBeFocused();
  const summary = dialog(page).locator("dl.confirm-summary");
  await expect(summary).toContainText("Campagne promotionnelle · Tous les clients abonnés");
  await expect(summary).toContainText("Café offert cette semaine");
  await expect(summary).toContainText("2 clients");
  await expect(dialog(page)).toContainText("Envoi définitif");

  await dialog(page).getByRole("button", { name: "Annuler" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(page.getByRole("button", { name: "Envoyer à 2 client(s)" })).toBeFocused();
  await page.getByRole("button", { name: "Envoyer à 2 client(s)" }).click();
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeHidden();
  expect(created).toHaveLength(0);

  await page.getByRole("button", { name: "Envoyer à 2 client(s)" }).click();
  await dialog(page).getByRole("button", { name: "Confirmer l’envoi à 2 clients" }).click();
  await expect(page.getByText("Campagne envoyée.")).toBeVisible({ timeout: 15_000 });
  expect(created).toHaveLength(1);
  expect(nativeDialogs).toBe(0);
});

test("campagne : audience recalculée à la confirmation, aucun envoi s'il n'y a plus personne", async ({ page }) => {
  await merchantWithSubscribers(page, "campaign-recount", 1);
  const created = watchCampaignCreation(page);
  await compose(page, "Première offre");
  // Entre-temps, une autre campagne a touché l'unique abonné : plus personne à contacter cette semaine.
  const other = await page.request.post("/api/campaigns", { headers: { origin }, data: { kind: "promotion", segment: "all", subject: "Autre", message: "Bonjour", idempotencyKey: crypto.randomUUID() } });
  expect(other.status()).toBe(201);
  const { id } = await other.json();
  for (let round = 0; round < 10; round += 1) {
    const sent = await page.request.post(`/api/campaigns/${id}/send`, { headers: { origin } });
    if ((await sent.json()).pending === 0) break;
  }

  await page.getByRole("button", { name: "Envoyer à 1 client(s)" }).click();
  await expect(dialog(page).locator("dl.confirm-summary")).toContainText("Aucun", { timeout: 15_000 });
  await expect(dialog(page).getByRole("alert")).toContainText("Aucun client à contacter");
  await expect(dialog(page).getByRole("button", { name: /Confirmer l’envoi/ })).toBeDisabled();
  // Aucune campagne créée depuis l'interface (l'autre envoi passe par l'API du test).
  expect(created).toHaveLength(0);
});

test("campagne : réseau perdu après confirmation, la reprise reste proposée", async ({ page }) => {
  await merchantWithSubscribers(page, "campaign-network", 1);
  await compose(page, "Offre réseau");
  await page.route("**/api/campaigns", (route) => route.abort("internetdisconnected"));
  await page.getByRole("button", { name: "Envoyer à 1 client(s)" }).click();
  await dialog(page).getByRole("button", { name: "Confirmer l’envoi à 1 client" }).click();
  await expect(page.locator(".notice[role=alert]")).toContainText("Connexion perdue", { timeout: 15_000 });
  await page.unroute("**/api/campaigns");
});

for (const width of [320, 390, 430]) {
  test(`campagne : confirmation utilisable à ${width} px`, async ({ page }) => {
    await merchantWithSubscribers(page, `campaign-${width}`, 1);
    await page.setViewportSize({ width, height: 640 });
    await compose(page, "Offre mobile");
    await page.getByRole("button", { name: "Envoyer à 1 client(s)" }).click();
    for (const name of [/Confirmer l’envoi/, /^Annuler$/]) {
      const target = dialog(page).getByRole("button", { name });
      await expect(target).toBeVisible();
      expect((await target.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    const box = await dialog(page).boundingBox();
    expect((box?.x ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 0) <= width).toBeTruthy();
  });
}
