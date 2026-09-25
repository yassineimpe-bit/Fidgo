import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { unsubscribePath } from "../../lib/unsubscribe";
import { createMerchant, origin, testClientIp, unique } from "./helpers";

// Même secret que le serveur de test (voir playwright.config.ts).
process.env.AUTH_SECRET ||= "fidgo-playwright-secret-at-least-32-characters";

async function slugOf(page: Page) {
  return String((await page.request.get("/api/restaurant").then((response) => response.json())).slug);
}

async function enroll(page: Page, slug: string, firstName: string, marketingConsent: boolean) {
  const response = await page.request.post("/api/enroll", {
    headers: { origin, "x-real-ip": testClientIp() },
    data: { slug, firstName, email: `${unique(firstName.toLowerCase())}@example.com`, marketingConsent },
  });
  expect(response.status()).toBe(201);
  return String((await response.json()).token);
}

async function customerIdOf(sql: postgres.Sql, token: string) {
  const [row] = await sql`select customer_id from cards where token=${token}`;
  return String(row.customer_id);
}

function createCampaign(page: Page, data: Record<string, unknown>) {
  return page.request.post("/api/campaigns", {
    headers: { origin },
    data: { kind: "promotion", segment: "all", subject: "Offre", message: "Bonjour", idempotencyKey: crypto.randomUUID(), ...data },
  });
}

async function preview(page: Page, data: Record<string, unknown>) {
  const response = await page.request.post("/api/campaigns/preview", { headers: { origin }, data });
  expect(response.status()).toBe(200);
  return Number((await response.json()).recipients);
}

test("campagnes : ciblage, envoi par lots, historique, anti-spam et limite hebdomadaire", async ({ page }) => {
  test.setTimeout(120_000);
  await createMerchant(page, "campaigns");
  const slug = await slugOf(page);
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const alice = await enroll(page, slug, "Alice", true);
    const bruno = await enroll(page, slug, "Bruno", true);
    await enroll(page, slug, "Chloe", false);

    // Segmentation : Alice est venue (crédit), Bruno a une récompense disponible.
    expect((await page.request.post("/api/credit", { headers: { origin }, data: { token: alice, idempotencyKey: crypto.randomUUID() } })).ok()).toBeTruthy();
    const program = await page.request.get("/api/program").then((response) => response.json());
    const adjusted = await page.request.post(`/api/customers/${await customerIdOf(sql, bruno)}/adjust`, {
      headers: { origin },
      data: { newBalance: Number(program.reward_threshold), reason: "Préparation campagne", idempotencyKey: crypto.randomUUID() },
    });
    expect(adjusted.ok()).toBeTruthy();
    expect(await preview(page, { segment: "all" })).toBe(2);
    expect(await preview(page, { segment: "active" })).toBe(1);
    expect(await preview(page, { segment: "reward_available" })).toBe(1);
    // Cartes créées à l'instant : personne n'est « inactif depuis 30 jours ».
    expect(await preview(page, { segment: "inactive", inactiveDays: 30 })).toBe(0);

    // Interface : composition et envoi à tous les clients abonnés.
    await page.goto("/dashboard/campaigns");
    await expect(page.getByText("2 client(s) sur 3 ont accepté")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("2 client(s) recevront cet e-mail.")).toBeVisible();
    await page.getByLabel("Objet").fill("Café offert cette semaine");
    await page.getByLabel("Message").fill("Bonjour,\n\nPassez nous voir : un café vous attend.");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Envoyer à 2 client(s)" }).click();
    await expect(page.getByText("Campagne envoyée.")).toBeVisible({ timeout: 15_000 });
    const history = page.getByRole("row", { name: /Café offert cette semaine/ });
    await expect(history).toContainText("2 / 2");
    await expect(history).toContainText("Envoyée");

    const [first] = await sql`
      select c.id, c.status, c.recipient_count, c.sent_count, c.created_by is not null as has_author
      from campaigns c join establishments e on e.id=c.establishment_id where e.slug=${slug}
    `;
    expect(first).toMatchObject({ status: "sent", recipient_count: 2, sent_count: 2, has_author: true });
    const recipients = await sql`select status from campaign_recipients where campaign_id=${first.id}`;
    expect(recipients.map((row) => row.status)).toEqual(["sent", "sent"]);
    const audits = await sql`select action, metadata from audit_logs where entity_id=${first.id} order by created_at`;
    expect(audits.map((row) => row.action)).toEqual(["CAMPAIGN_CREATED", "CAMPAIGN_SENT"]);
    expect(audits[0].metadata).toEqual({ kind: "promotion", segment: "all", inactiveDays: null, recipientCount: 2 });

    // Un client ne reçoit pas deux e-mails dans la même semaine : plus personne à contacter.
    expect(await preview(page, { segment: "all" })).toBe(0);
    const empty = await createCampaign(page, {});
    expect(empty.status()).toBe(409);
    expect(await empty.json()).toEqual({ error: "NO_RECIPIENTS" });

    // Seconde campagne avec un nouvel abonné ; rejouer la même clé ne crée rien de plus.
    await enroll(page, slug, "Dora", true);
    const key = crypto.randomUUID();
    const second = await createCampaign(page, { idempotencyKey: key, subject: "Nouveauté" });
    expect(second.status()).toBe(201);
    const { id: secondId, recipientCount } = await second.json();
    expect(recipientCount).toBe(1);
    const replay = await createCampaign(page, { idempotencyKey: key, subject: "Nouveauté" });
    expect(replay.status()).toBe(200);
    expect((await replay.json()).id).toBe(secondId);

    // Envoi repris depuis l'historique.
    await page.goto("/dashboard/campaigns");
    await page.getByRole("row", { name: /Nouveauté/ }).getByRole("button", { name: "Reprendre l’envoi" }).click();
    await expect(page.getByRole("row", { name: /Nouveauté/ })).toContainText("Envoyée", { timeout: 15_000 });
    // Un envoi terminé ne renvoie rien.
    const again = await page.request.post(`/api/campaigns/${secondId}/send`, { headers: { origin } });
    expect(await again.json()).toMatchObject({ status: "sent", sentCount: 1, pending: 0 });

    // Deux campagnes sur 7 jours : la troisième est refusée, même avec des destinataires.
    await enroll(page, slug, "Emile", true);
    const third = await createCampaign(page, {});
    expect(third.status()).toBe(429);
    expect((await third.json()).error).toBe("CAMPAIGN_LIMIT");
    await page.reload();
    await expect(page.getByText(/Limite atteinte : prochaine campagne possible le/)).toBeVisible();
    const [{ total }] = await sql`select count(*)::int as total from campaigns c join establishments e on e.id=c.establishment_id where e.slug=${slug}`;
    expect(total).toBe(2);
  } finally {
    await sql.end({ timeout: 5 });
  }
});

test("campagnes : désabonnement pendant l'envoi, rôles, origine et isolation entre commerces", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await createMerchant(page, "campaigns-guard");
  const slug = await slugOf(page);
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const first = await enroll(page, slug, "Farid", true);
    await enroll(page, slug, "Gina", true);

    expect((await page.request.post("/api/campaigns", { headers: { origin: "https://evil.example" }, data: {} })).status()).toBe(403);
    const invalid = await createCampaign(page, { subject: "" });
    expect(invalid.status()).toBe(400);
    expect(await invalid.json()).toEqual({ error: "INVALID_FIELD", field: "subject" });

    const created = await createCampaign(page, { kind: "promotion", segment: "all" });
    expect(created.status()).toBe(201);
    const { id } = await created.json();

    // Farid se désabonne entre la création et l'envoi : il est ignoré.
    const unsubscribed = await page.request.post(`/api${unsubscribePath(await customerIdOf(sql, first))}`);
    expect(unsubscribed.status()).toBe(200);

    // Un autre commerce ne voit ni n'envoie cette campagne.
    const otherContext = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": testClientIp() } });
    try {
      const other = await otherContext.newPage();
      await createMerchant(other, "campaigns-other");
      expect((await other.request.post(`/api/campaigns/${id}/send`, { headers: { origin } })).status()).toBe(404);
      const list = await other.request.get("/api/campaigns").then((response) => response.json());
      expect(list.campaigns).toEqual([]);
    } finally {
      await otherContext.close();
    }

    const progress = await page.request.post(`/api/campaigns/${id}/send`, { headers: { origin } });
    expect(await progress.json()).toMatchObject({ status: "sent", recipientCount: 2, sentCount: 1, skippedCount: 1, pending: 0 });
    const statuses = await sql`select status, error from campaign_recipients where campaign_id=${id} order by status`;
    expect(statuses.map((row) => [row.status, row.error])).toEqual([["sent", null], ["skipped", "CONSENT_WITHDRAWN"]]);

    // EMPLOYEE : ni aperçu, ni création, ni envoi ; la page le renvoie au scanner.
    const email = `${unique("campaign-employee")}@example.com`;
    const password = "Password-test-123!";
    expect((await page.request.post("/api/employees", { headers: { origin }, data: { email, password, role: "EMPLOYEE" } })).ok()).toBeTruthy();
    const employeeContext = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": testClientIp() } });
    try {
      const employee = await employeeContext.newPage();
      expect((await employee.request.post(`${origin}/api/auth/login`, { headers: { origin }, data: { email, password } })).status()).toBe(200);
      expect((await employee.request.post(`${origin}/api/campaigns/preview`, { headers: { origin }, data: { segment: "all" } })).status()).toBe(403);
      expect((await employee.request.post(`${origin}/api/campaigns`, { headers: { origin }, data: {} })).status()).toBe(403);
      expect((await employee.request.post(`${origin}/api/campaigns/${id}/send`, { headers: { origin } })).status()).toBe(403);
      expect((await employee.request.get(`${origin}/api/campaigns`)).status()).toBe(403);
      await employee.goto(`${origin}/dashboard/campaigns`);
      await expect(employee).toHaveURL(/\/s$/);
    } finally {
      await employeeContext.close();
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
});
