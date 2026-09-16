import { expect, test } from "@playwright/test";
import { createMerchant, origin, randomizeClientIp, unique } from "./helpers";

test("auth : signup, logout puis login redonnent accès au dashboard", async ({ page }) => {
  const marker = unique("auth");
  const email = `${marker}@example.com`;
  const password = "Password-test-123!";

  await randomizeClientIp(page);
  await page.goto("/signup");
  await page.getByLabel("Nom du commerce").fill(`Commerce ${marker}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Créer mon espace" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.getByRole("button", { name: "Déconnexion" }).click();
  await expect(page).toHaveURL(/\/login$/);

  // La session est bien révoquée : /dashboard redirige vers /login sans cookie valide.
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("rôle : un EMPLOYEE ne peut pas faire ce qui est réservé OWNER/MANAGER", async ({ page }) => {
  await createMerchant(page, "role");

  const employeeEmail = `${unique("employee")}@example.com`;
  const employeePassword = "Password-test-123!";
  const createEmployee = await page.request.post("/api/employees", {
    headers: { origin },
    data: { email: employeeEmail, password: employeePassword, role: "EMPLOYEE" },
  });
  expect(createEmployee.ok()).toBeTruthy();
  const employees = await (await page.request.get("/api/employees")).json();
  const employeeId = employees.find((e: { email: string }) => e.email === employeeEmail)?.id;
  expect(employeeId).toBeTruthy();

  // Nouvelle session, isolée du cookie OWNER, connectée en tant qu'EMPLOYEE.
  const employeeContext = await page.context().browser()!.newContext();
  const employeePage = await employeeContext.newPage();
  try {
    await employeePage.goto("/login");
    await employeePage.getByLabel("Email").fill(employeeEmail);
    await employeePage.getByLabel("Mot de passe").fill(employeePassword);
    await employeePage.getByRole("button", { name: "Se connecter" }).click();
    await expect(employeePage).toHaveURL(/\/dashboard$/);

    const patchOther = await employeePage.request.patch(`/api/employees/${employeeId}`, {
      headers: { origin },
      data: { active: false },
    });
    expect(patchOther.status()).toBe(403);

    const createAnother = await employeePage.request.post("/api/employees", {
      headers: { origin },
      data: { email: `${unique("blocked")}@example.com`, password: "Password-test-123!", role: "EMPLOYEE" },
    });
    expect(createAnother.status()).toBe(403);

    const patchProgram = await employeePage.request.patch("/api/program", {
      headers: { origin },
      data: { mode: "STAMPS", pointsRule: "PER_PURCHASE", rewardThreshold: 5, stampsPerVisit: 1, pointsPerPurchase: 1, pointsPerEuro: 1 },
    });
    expect(patchProgram.status()).toBe(403);

    const reverse = await employeePage.request.post("/api/transactions/reverse", {
      headers: { origin },
      data: { transactionId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() },
    });
    expect(reverse.status()).toBe(403);
  } finally {
    await employeeContext.close();
  }
});
