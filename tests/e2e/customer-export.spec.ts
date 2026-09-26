import { expect, test } from "@playwright/test";
import { createMerchant, enrollCustomer, origin, testClientIp, unique } from "./helpers";

test.setTimeout(60_000);

test("export clients : recherche courante, colonnes, tenant et aucun token complet", async ({ page }) => {
  await createMerchant(page, "customers-csv-a");
  const firstEmail = `${unique("csv-marie")}@example.com`;
  const { cardUrl, shortCode } = await enrollCustomer(page, "Marie", firstEmail);
  const restaurant = await (await page.request.get("/api/restaurant")).json();
  const otherEmail = `${unique("csv-lina")}@example.com`;
  const secondEnroll = await page.request.post("/api/enroll", {
    headers: { origin }, data: { slug: restaurant.slug, firstName: "Lina", email: otherEmail },
  });
  expect(secondEnroll.status()).toBe(201);
  await page.goto("/dashboard/clients?q=Marie");
  const link = page.getByRole("link", { name: "Télécharger le CSV clients" });
  await expect(link).toHaveAttribute("href", "/api/customers/export?q=Marie");

  const response = await page.request.get("/api/customers/export?q=Marie");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["content-type"]).toContain("text/csv");
  const csv = await response.text();
  expect(csv.startsWith("\uFEFFNom;Prénom;Email;")).toBe(true);
  expect(csv).toContain(firstEmail);
  expect(csv).toContain(shortCode);
  expect(csv).not.toContain(otherEmail);
  expect(csv).not.toContain(new URL(cardUrl).pathname.split("/").at(-1)!);

  const otherContext = await page.context().browser()!.newContext();
  const otherPage = await otherContext.newPage();
  try {
    const signup = await otherPage.request.post("/api/auth/signup", {
      headers: { origin, "x-real-ip": testClientIp() },
      data: {
        restaurantName: `Commerce ${unique("customers-csv-b")}`,
        email: `${unique("customers-csv-b")}@example.com`,
        password: "Password-test-123!",
      },
    });
    expect(signup.ok()).toBeTruthy();
    const foreign = await otherPage.request.get("/api/customers/export");
    expect(foreign.status()).toBe(200);
    expect(await foreign.text()).not.toContain(firstEmail);
  } finally {
    await otherContext.close();
  }
});

test("export clients : EMPLOYEE interdit même par appel direct", async ({ page }) => {
  await createMerchant(page, "customers-csv-role");
  const email = `${unique("csv-employee")}@example.com`;
  const password = "Password-test-123!";
  expect((await page.request.post("/api/employees", {
    headers: { origin }, data: { email, password, role: "EMPLOYEE" },
  })).ok()).toBeTruthy();
  const employeeContext = await page.context().browser()!.newContext();
  const employeePage = await employeeContext.newPage();
  try {
    await employeePage.goto("/login");
    await employeePage.getByLabel("Email").fill(email);
    await employeePage.getByLabel("Mot de passe").fill(password);
    await employeePage.getByRole("button", { name: "Se connecter" }).click();
    await expect(employeePage).toHaveURL(/\/dashboard$/);
    expect((await employeePage.request.get("/api/customers/export")).status()).toBe(403);
    await employeePage.goto("/dashboard/clients");
    await expect(employeePage.getByRole("link", { name: "Télécharger le CSV clients" })).toHaveCount(0);
  } finally {
    await employeeContext.close();
  }
});
