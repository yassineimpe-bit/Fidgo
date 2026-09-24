import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { createMerchant, origin, unique } from "./helpers";

// Régression de sécurité : les payloads stockés doivent rester du texte inerte dans React.
type XssWindow = Window & { __retikoXss?: number };

async function armXssSentinel(page: Page) {
  await page.addInitScript(() => {
    (window as XssWindow).__retikoXss = 0;
  });
}

async function expectNoXssExecution(page: Page) {
  expect(await page.evaluate(() => (window as XssWindow).__retikoXss ?? 0)).toBe(0);
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  await expect(page.locator("svg[onload]")).toHaveCount(0);
}

test("XSS stocké commerçant : nom et récompense restent du texte sur la page publique", async ({ page }) => {
  await createMerchant(page, "xss-merchant");

  const restaurantResponse = await page.request.get("/api/restaurant");
  expect(restaurantResponse.ok()).toBeTruthy();
  const restaurant = await restaurantResponse.json();

  const merchantPayload = '<img src=x onerror="window.__retikoXss=1">';
  const rewardPayload = '<svg onload="window.__retikoXss=2"></svg>';

  const restaurantPatch = await page.request.patch("/api/restaurant", {
    headers: { origin },
    data: { name: merchantPayload },
  });
  expect(restaurantPatch.ok()).toBeTruthy();

  await armXssSentinel(page);
  await page.goto("/dashboard/program");
  await expectNoXssExecution(page);
  await page.getByLabel("Récompense", { exact: true }).fill(rewardPayload);
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Programme enregistré.")).toBeVisible();
  await expectNoXssExecution(page);

  await page.goto(`/j/${restaurant.slug}`);

  await expect(page.locator("h2")).toHaveText(merchantPayload);
  await expect(page.locator("p.muted")).toContainText(rewardPayload);
  await expectNoXssExecution(page);

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const [row] = await sql`
      select e.name, p.reward_label,
        (select count(*)::int from loyalty_programs where establishment_id=e.id) as program_count,
        (select count(*)::int from staff_users where establishment_id=e.id and role='OWNER') as owner_count
      from establishments e
      join loyalty_programs p on p.establishment_id=e.id
      where e.slug=${restaurant.slug}
    `;
    expect(row).toMatchObject({
      name: merchantPayload,
      reward_label: rewardPayload,
      program_count: 1,
      owner_count: 1,
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
});

test("XSS stocké client : le prénom contrôlé par un visiteur reste du texte dans le back-office", async ({ page }) => {
  await createMerchant(page, "xss-customer");

  const restaurantResponse = await page.request.get("/api/restaurant");
  expect(restaurantResponse.ok()).toBeTruthy();
  const restaurant = await restaurantResponse.json();

  const customerPayload = '<img src=x onerror="window.__retikoXss=7">';
  const email = `${unique("xss-client")}@example.com`;

  const enroll = await page.request.post("/api/enroll", {
    headers: { origin },
    data: {
      slug: restaurant.slug,
      email,
      firstName: customerPayload,
      marketingConsent: false,
    },
  });
  expect(enroll.status()).toBe(201);

  await armXssSentinel(page);
  await page.goto("/dashboard/clients");

  const clientLink = page.getByRole("link", { name: customerPayload });
  await expect(clientLink).toBeVisible();
  await expectNoXssExecution(page);

  await clientLink.click();
  await expect(page).toHaveURL(/\/dashboard\/clients\/[0-9a-f-]+$/);
  await expect(page.getByText(customerPayload, { exact: true })).toBeVisible();
  await expectNoXssExecution(page);

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const rows = await sql`
      select first_name
      from customers
      where establishment_id=${restaurant.id}
        and lower(email)=lower(${email})
        and deleted_at is null
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].first_name).toBe(customerPayload);
  } finally {
    await sql.end({ timeout: 5 });
  }
});
