import { expect, test, type Browser, type Page } from "@playwright/test";
import { createMerchant, origin, randomizeClientIp, testClientIp, unique } from "./helpers";

const PASSWORD = "Password-test-123!";

async function createStaff(page: Page, role: "EMPLOYEE" | "VIEWER") {
  const email = `${unique(`lookup-${role.toLowerCase()}`)}@example.com`;
  const response = await page.request.post("/api/employees", {
    headers: { origin },
    data: { email, password: PASSWORD, role },
  });
  expect(response.status()).toBe(201);
  return email;
}

async function login(browser: Browser, email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await randomizeClientIp(page);
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  return { context, page };
}

async function enroll(page: Page, slug: string, email: string, phone: string) {
  const response = await page.request.post("/api/enroll", {
    headers: { origin, "x-real-ip": testClientIp() },
    data: { slug, firstName: "Nora privée", email, phone },
  });
  expect(response.status()).toBe(201);
  return response.json() as Promise<{ token: string; short_code: string }>;
}

async function lookup(page: Page, query: string) {
  const response = await page.request.get(`/api/lookup?q=${encodeURIComponent(query)}`);
  expect(response.status()).toBe(200);
  const body = await response.json() as Record<string, unknown>;
  expect(Object.keys(body)).toEqual(["token"]);
  expect(body.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
  return body;
}

test("lookup caisse : l'EMPLOYEE retrouve la carte sans recevoir de PII", async ({ page, browser }) => {
  test.setTimeout(120_000);

  await createMerchant(page, "lookup-privacy-a");
  const restaurantA = await page.request.get("/api/restaurant").then((response) => response.json());
  const customerEmail = `${unique("lookup-private-customer")}@example.com`;
  const customerPhone = "+33 6 12 34 56 78";
  const cardA = await enroll(page, String(restaurantA.slug), customerEmail, customerPhone);
  const employeeEmail = await createStaff(page, "EMPLOYEE");
  const viewerEmail = await createStaff(page, "VIEWER");

  const employee = await login(browser, employeeEmail);
  const viewer = await login(browser, viewerEmail);
  const foreignContext = await browser.newContext();
  const foreignPage = await foreignContext.newPage();
  try {
    for (const query of [cardA.short_code, "06 12 34 56 78", customerEmail.toUpperCase()]) {
      const body = await lookup(employee.page, query);
      expect(JSON.stringify(body)).not.toContain(customerEmail);
      expect(JSON.stringify(body)).not.toContain(customerPhone);
      expect(JSON.stringify(body)).not.toContain("Nora privée");
    }

    // Le scanner manuel enchaîne toujours le token opaque vers /api/scan,
    // seule route qui fournit les données nécessaires au poste caisse.
    await employee.page.goto("/s");
    await employee.page.getByPlaceholder("Code court ou email, ou téléphone").fill(cardA.short_code);
    await employee.page.getByRole("button", { name: "Chercher" }).click();
    await expect(employee.page.getByText("Nora privée")).toBeVisible({ timeout: 15_000 });
    await expect(employee.page.getByText(/0 \/ 10 tampons/)).toBeVisible();

    await createMerchant(foreignPage, "lookup-privacy-b");
    const restaurantB = await foreignPage.request.get("/api/restaurant").then((response) => response.json());
    const foreignCard = await enroll(
      foreignPage,
      String(restaurantB.slug),
      `${unique("lookup-foreign-customer")}@example.com`,
      "+33 7 98 76 54 32",
    );
    const hidden = await employee.page.request.get(`/api/lookup?q=${foreignCard.short_code}`);
    expect(hidden.status()).toBe(404);

    const forbidden = await viewer.page.request.get(`/api/lookup?q=${cardA.short_code}`);
    expect(forbidden.status()).toBe(403);
  } finally {
    await Promise.all([employee.context.close(), viewer.context.close(), foreignContext.close()]);
  }
});
