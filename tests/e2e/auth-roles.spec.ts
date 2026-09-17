import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { createMerchant, logout, origin, randomizeClientIp, unique } from "./helpers";

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

  await logout(page);
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

    const patchRestaurant = await employeePage.request.patch("/api/restaurant", {
      headers: { origin },
      data: { name: "Privilege escalation" },
    });
    expect(patchRestaurant.status()).toBe(403);

    const listTeam = await employeePage.request.get("/api/employees");
    expect(listTeam.status()).toBe(403);

    const suspend = await employeePage.request.post("/api/restaurant/suspend", {
      headers: { origin },
      data: { confirmation: "SUSPENDRE", confirmationSlug: "injected" },
    });
    expect(suspend.status()).toBe(403);

    const reverse = await employeePage.request.post("/api/transactions/reverse", {
      headers: { origin },
      data: { transactionId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() },
    });
    expect(reverse.status()).toBe(403);

    const customerId = crypto.randomUUID();
    const adjust = await employeePage.request.post(`/api/customers/${customerId}/adjust`, {
      headers: { origin },
      data: { newBalance: 1, reason: "escalade", idempotencyKey: crypto.randomUUID() },
    });
    expect(adjust.status()).toBe(403);
    expect((await employeePage.request.get(`/api/customers/${customerId}/export`)).status()).toBe(403);
    expect((await employeePage.request.delete(`/api/customers/${customerId}`, { headers: { origin } })).status()).toBe(403);
  } finally {
    await employeeContext.close();
  }
});

test("rôle : un MANAGER administre le pilote mais ne peut pas modifier OWNER/MANAGER", async ({ page }) => {
  await createMerchant(page, "manager-boundary");
  const managerEmail = `${unique("manager")}@example.com`;
  const targetEmail = `${unique("manager-target")}@example.com`;
  const password = "Password-test-123!";

  const manager = await page.request.post("/api/employees", {
    headers: { origin },
    data: { email: managerEmail, password, role: "EMPLOYEE" },
  }).then((response) => response.json());
  const target = await page.request.post("/api/employees", {
    headers: { origin },
    data: { email: targetEmail, password, role: "EMPLOYEE" },
  }).then((response) => response.json());
  const employees = await page.request.get("/api/employees").then((response) => response.json());
  const owner = employees.find((employee: { role: string }) => employee.role === "OWNER");

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  const managerContext = await page.context().browser()!.newContext();
  const managerPage = await managerContext.newPage();
  try {
    await sql`update staff_users set role='MANAGER',updated_at=now() where id=${manager.id}`;
    await managerPage.goto("/login");
    await managerPage.getByLabel("Email").fill(managerEmail);
    await managerPage.getByLabel("Mot de passe").fill(password);
    await managerPage.getByRole("button", { name: "Se connecter" }).click();
    await expect(managerPage).toHaveURL(/\/dashboard$/);

    const disableEmployee = await managerPage.request.patch(`/api/employees/${target.id}`, {
      headers: { origin },
      data: { active: false },
    });
    expect(disableEmployee.ok()).toBeTruthy();
    const touchOwner = await managerPage.request.patch(`/api/employees/${owner.id}`, {
      headers: { origin },
      data: { active: false },
    });
    expect(touchOwner.status()).toBe(403);
    const touchSelf = await managerPage.request.patch(`/api/employees/${manager.id}`, {
      headers: { origin },
      data: { active: false },
    });
    expect(touchSelf.status()).toBe(409);
    const suspendAsManager = await managerPage.request.post("/api/restaurant/suspend", {
      headers: { origin },
      data: { confirmation: "SUSPENDRE", confirmationSlug: "injected" },
    });
    expect(suspendAsManager.status()).toBe(403);

    // Une rétrogradation en base s'applique à la session existante dès la
    // requête suivante, même si le JWT contient encore l'ancien rôle.
    await sql`update staff_users set role='EMPLOYEE',updated_at=now() where id=${manager.id}`;
    const afterDemotion = await managerPage.request.patch("/api/restaurant", {
      headers: { origin },
      data: { name: "Ancien manager" },
    });
    expect(afterDemotion.status()).toBe(403);
  } finally {
    await sql.end({ timeout: 5 });
    await managerContext.close();
  }
});

test("session : désactivation, réactivation et changement de rôle révoquent les anciens droits", async ({ page }) => {
  await createMerchant(page, "session-revocation");
  const employeeEmail = `${unique("session-employee")}@example.com`;
  const password = "Password-test-123!";
  const created = await page.request.post("/api/employees", {
    headers: { origin },
    data: { email: employeeEmail, password, role: "EMPLOYEE" },
  });
  expect(created.status()).toBe(201);
  const employee = await created.json();

  const employeeContext = await page.context().browser()!.newContext();
  const employeePage = await employeeContext.newPage();
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await employeePage.goto("/login");
    await employeePage.getByLabel("Email").fill(employeeEmail);
    await employeePage.getByLabel("Mot de passe").fill(password);
    await employeePage.getByRole("button", { name: "Se connecter" }).click();
    await expect(employeePage).toHaveURL(/\/dashboard$/);

    const disabled = await page.request.patch(`/api/employees/${employee.id}`, {
      headers: { origin },
      data: { active: false },
    });
    expect(disabled.ok()).toBeTruthy();
    expect((await employeePage.request.get("/api/dashboard")).status()).toBe(401);

    const reenabled = await page.request.patch(`/api/employees/${employee.id}`, {
      headers: { origin },
      data: { active: true },
    });
    expect(reenabled.ok()).toBeTruthy();
    // Le cookie émis avant la désactivation reste révoqué après réactivation.
    expect((await employeePage.request.get("/api/dashboard")).status()).toBe(401);

    await employeePage.goto("/login");
    await employeePage.getByLabel("Email").fill(employeeEmail);
    await employeePage.getByLabel("Mot de passe").fill(password);
    await employeePage.getByRole("button", { name: "Se connecter" }).click();
    await expect(employeePage).toHaveURL(/\/dashboard$/);

    // getSession relit le rôle courant en base à chaque requête : un JWT
    // EMPLOYEE ne conserve donc pas canScan après passage en VIEWER.
    await sql`update staff_users set role='VIEWER',updated_at=now() where id=${employee.id}`;
    const scan = await employeePage.request.post("/api/scan", {
      headers: { origin },
      data: { token: `LOY1:${"A".repeat(20)}` },
    });
    expect(scan.status()).toBe(403);
  } finally {
    await sql.end({ timeout: 5 });
    await employeeContext.close();
  }
});
