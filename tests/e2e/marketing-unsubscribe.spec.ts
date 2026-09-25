import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { unsubscribePath } from "../../lib/unsubscribe";
import { createMerchant, enrollCustomer, origin, testClientIp, unique } from "./helpers";

// Même secret que le serveur de test (voir playwright.config.ts) : le test
// fabrique le lien qu'un e-mail promotionnel contiendrait.
process.env.AUTH_SECRET ||= "fidgo-playwright-secret-at-least-32-characters";

async function marketingState(sql: postgres.Sql, customerId: string) {
  const [row] = await sql`select marketing_consent, marketing_consent_at from customers where id=${customerId}`;
  return row;
}

async function audits(sql: postgres.Sql, customerId: string) {
  return sql`
    select action, staff_user_id, metadata from audit_logs
    where entity_id=${customerId} and action like 'CUSTOMER_MARKETING_%' order by created_at, id
  `;
}

test("offres par e-mail : le client choisit depuis sa carte, se désabonne en un clic, tout est audité", async ({ page, browser }) => {
  test.setTimeout(90_000);
  await createMerchant(page, "unsubscribe");
  const { cardUrl } = await enrollCustomer(page, "Nora", `${unique("nora")}@example.com`);
  const token = new URL(cardUrl).pathname.split("/").at(-1)!;
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const [customer] = await sql`select cu.id from cards c join customers cu on cu.id=c.customer_id where c.token=${token}`;
    const customerId = String(customer.id);
    expect(await marketingState(sql, customerId)).toMatchObject({ marketing_consent: false, marketing_consent_at: null });

    // Depuis la carte : le client consent lui-même.
    const checkbox = page.getByRole("checkbox", { name: /Recevoir les offres et nouvelles de/ });
    await expect(checkbox).not.toBeChecked();
    await checkbox.check();
    await expect(page.getByText("Vous recevrez les offres de ce commerce.")).toBeVisible();
    await expect.poll(async () => (await marketingState(sql, customerId)).marketing_consent).toBe(true);
    expect((await marketingState(sql, customerId)).marketing_consent_at).not.toBeNull();
    await page.reload();
    await expect(page.getByRole("checkbox", { name: /Recevoir les offres et nouvelles de/ })).toBeChecked();

    // Autre origine refusée, entrée invalide refusée, carte inconnue : 404.
    const api = `/api/card/${token}/marketing`;
    expect((await page.request.patch(api, { headers: { origin: "https://evil.example" }, data: { marketingConsent: false } })).status()).toBe(403);
    expect((await page.request.patch(api, { headers: { origin }, data: { marketingConsent: "no" } })).status()).toBe(400);
    expect((await page.request.patch(`/api/card/${"A".repeat(token.length)}/marketing`, { headers: { origin }, data: { marketingConsent: false } })).status()).toBe(404);
    expect((await marketingState(sql, customerId)).marketing_consent).toBe(true);

    // Lien d'e-mail : un GET (préchargement de messagerie) ne désabonne pas.
    const anonymous = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": testClientIp() } });
    try {
      const link = unsubscribePath(customerId);
      const visitor = await anonymous.newPage();
      const response = await visitor.goto(`${origin}${link}`);
      expect(response?.headers()["cache-control"]).toContain("no-store");
      expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
      expect(response?.headers()["x-robots-tag"]).toContain("noindex");
      await expect(visitor.getByRole("heading", { name: "Désabonnement" })).toBeVisible();
      await expect(visitor.getByText(/Commerce unsubscribe-/)).toBeVisible();
      expect((await marketingState(sql, customerId)).marketing_consent).toBe(true);

      await visitor.getByRole("button", { name: "Me désabonner" }).click();
      await expect(visitor.getByText(/Vous êtes désabonné/)).toBeVisible();
      expect(await marketingState(sql, customerId)).toMatchObject({ marketing_consent: false, marketing_consent_at: null });

      // Rejeu (RFC 8058, POST sans origine) : idempotent, aucun audit en double.
      const replay = await anonymous.request.post(`${origin}/api${link}`);
      expect(replay.status()).toBe(200);
      await visitor.reload();
      await expect(visitor.getByText(/Vous êtes désabonné/)).toBeVisible();

      // Lien falsifié ou pour un autre client : rien ne change.
      const forged = link.slice(0, -2) + (link.endsWith("AA") ? "BB" : "AA");
      expect((await anonymous.request.post(`${origin}/api${forged}`)).status()).toBe(404);
      expect((await visitor.goto(`${origin}${forged}`))?.status()).toBe(404);
    } finally {
      await anonymous.close();
    }

    const rows = await audits(sql, customerId);
    expect(rows.map((row) => [row.action, row.staff_user_id, row.metadata])).toEqual([
      ["CUSTOMER_MARKETING_GRANTED", null, { source: "customer_card" }],
      ["CUSTOMER_MARKETING_WITHDRAWN", null, { source: "unsubscribe_link" }],
    ]);

    // La carte reflète le retrait.
    await page.reload();
    await expect(page.getByRole("checkbox", { name: /Recevoir les offres et nouvelles de/ })).not.toBeChecked();
  } finally {
    await sql.end({ timeout: 5 });
  }
});

test("offres par e-mail : sans adresse e-mail, aucun consentement possible", async ({ page }) => {
  await createMerchant(page, "unsubscribe-no-email");
  const joinPath = await page.locator("code").filter({ hasText: "/j/" }).textContent();
  const slug = joinPath!.replace(/^\/j\//, "");
  const enrolled = await page.request.post("/api/enroll", {
    headers: { origin, "x-real-ip": testClientIp() },
    data: { slug, firstName: "Sam", email: `${unique("sam")}@example.com` },
  });
  expect(enrolled.status()).toBe(201);
  const { token } = await enrolled.json();
  // Client plus ancien ou dont l'adresse a été retirée : aucune adresse connue.
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`update customers set email=null where id=(select customer_id from cards where token=${token})`;
  } finally {
    await sql.end({ timeout: 5 });
  }
  const granted = await page.request.patch(`/api/card/${token}/marketing`, { headers: { origin }, data: { marketingConsent: true } });
  expect(granted.status()).toBe(400);
  expect(await granted.json()).toEqual({ error: "EMAIL_REQUIRED" });
  await page.goto(`/c/${token}`);
  await expect(page.getByText("Aucune adresse e-mail n’est associée à cette carte")).toBeVisible();
});
