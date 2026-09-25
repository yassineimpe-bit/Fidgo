import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { createMerchant, enrollCustomer, openCardInScanner, unique } from "./helpers";

test("fiche client : profil, solde et historique sont accessibles depuis la liste", async ({ page }) => {
  await createMerchant(page, "customer-detail");
  const email = `${unique("customer-detail")}@example.com`;
  const { shortCode } = await enrollCustomer(page, "Maya", email);

  await openCardInScanner(page, shortCode);
  await page.getByRole("button", { name: "+1 tampon" }).click();
  await expect(page.getByText("+1 validé")).toBeVisible();

  await page.goto("/dashboard/clients");
  await page.getByRole("link", { name: "Maya" }).click();
  await expect(page).toHaveURL(/\/dashboard\/clients\//);
  await expect(page.getByRole("heading", { name: "Maya" })).toBeVisible();
  await expect(page.getByLabel("E-mail")).toHaveValue(email);
  await expect(page.getByText("1", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "Crédit", exact: true })).toBeVisible();
  await expect(page.getByText("+1", { exact: true })).toBeVisible();
  await expect(page.getByText("jours de visite crédités")).toBeVisible();
  await expect(page.getByText("unités créditées non annulées")).toBeVisible();
  await expect(page.getByText("Première visite créditée")).toBeVisible();
  await expect(page.getByText("Dernière visite créditée")).toBeVisible();
  await expect(page.getByText("Dernière transaction")).toBeVisible();
  await expect(page.getByRole("link", { name: /Ouvrir le scanner/ })).toHaveAttribute("href", "/s");
});


test("fiche client : un autre commerce ne peut pas accéder au client", async ({ page }) => {
  await createMerchant(page, "customer-detail-tenant-a");
  const { shortCode } = await enrollCustomer(page, "Lina", `${unique("tenant-a-client")}@example.com`);

  await page.goto("/dashboard/clients");
  await page.getByRole("link", { name: "Lina" }).click();
  await expect(page).toHaveURL(/\/dashboard\/clients\/[0-9a-f-]+$/);
  const customerPath = new URL(page.url()).pathname;
  expect(customerPath).toMatch(/^\/dashboard\/clients\/[0-9a-f-]+$/);

  const otherContext = await page.context().browser()!.newContext();
  const otherPage = await otherContext.newPage();
  try {
    await createMerchant(otherPage, "customer-detail-tenant-b");
    const response = await otherPage.request.get(customerPath);
    expect(response.status()).toBe(404);

    // La carte du tenant A reste évidemment introuvable dans le scanner du tenant B.
    const scanLookup = await otherPage.request.get(`/api/lookup?q=${encodeURIComponent(shortCode)}`);
    expect(scanLookup.status()).toBe(404);
  } finally {
    await otherContext.close();
  }
});

test("fiche client : historique vide, ID invalide et pagination après 50 écritures", async ({ page }) => {
  await createMerchant(page, "customer-detail-pages");
  const { cardUrl } = await enrollCustomer(page, "Noé", `${unique("detail-pages")}@example.com`);
  const cardToken = new URL(cardUrl).pathname.split("/").at(-1)!;
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

  try {
    const [card] = await sql`select id,establishment_id from cards where token=${cardToken}`;
    const [staff] = await sql`select id from staff_users where establishment_id=${card.establishment_id} and role='OWNER'`;
    await page.goto("/dashboard/clients");
    await page.getByRole("link", { name: "Noé" }).click();
    await expect(page).toHaveURL(/\/dashboard\/clients\/[0-9a-f-]+$/);
    const detailPath = new URL(page.url()).pathname;
    await expect(page.getByText("Aucune transaction.")).toBeVisible();
    await expect(page.getByText("Aucune", { exact: true })).toHaveCount(3);
    expect((await page.locator("main").textContent()) || "").not.toContain(cardToken);
    expect((await page.request.get("/dashboard/clients/not-a-uuid")).status()).toBe(404);

    await sql`
      insert into transactions(establishment_id,card_id,staff_user_id,type,delta,balance_after,unit,idempotency_key,created_at)
      select ${card.establishment_id},${card.id},${staff.id},'earn',1,n,'STAMP',
        'detail-page-' || ${card.id}::text || '-' || n::text,
        now() - ((55-n)::int * interval '1 day')
      from generate_series(1,55) as n
    `;
    await sql`update cards set balance=55,last_earn_at=now() where id=${card.id}`;

    await page.goto(detailPath);
    await expect(page.getByText("55 écritures · page 1/2 · 50 par page.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Suivant →" })).toBeVisible();
    await page.getByRole("link", { name: "Suivant →" }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByText("55 écritures · page 2/2 · 50 par page.")).toBeVisible();
    await expect(page.getByRole("link", { name: "← Précédent" })).toBeVisible();
    await expect(page.locator("tbody tr")).toHaveCount(5);
  } finally {
    await sql.end({ timeout: 5 });
  }
});
