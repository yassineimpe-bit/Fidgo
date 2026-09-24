import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { createMerchant, logout, origin, randomizeClientIp, unique } from "./helpers";

test("auth : signup vérifié, logout puis login redonnent accès au dashboard", async ({ page }) => {
  const marker = unique("auth");
  const email = `${marker}@example.com`;
  const password = "Password-test-123!";

  await randomizeClientIp(page);
  await page.goto("/signup");
  await page.getByLabel("Nom du commerce").fill(`Commerce ${marker}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill(password);

  const signupResponsePromise = page.waitForResponse(
    (response) => response.url().endsWith("/api/auth/signup") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Créer mon espace" }).click();
  const signupResponse = await signupResponsePromise;
  expect(signupResponse.status()).toBe(202);
  const signup = await signupResponse.json() as { verificationToken?: string };
  expect(signup.verificationToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

  // Aucune session n'est créée avant la preuve e-mail + mot de passe.
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);

  const blockedLogin = await page.request.post("/api/auth/login", {
    headers: { origin },
    data: { email, password },
  });
  expect(blockedLogin.status()).toBe(403);
  expect((await blockedLogin.json()).error).toBe("EMAIL_NOT_VERIFIED");

  const verified = await page.request.post("/api/auth/verify-email", {
    headers: { origin },
    data: { token: signup.verificationToken, password },
  });
  expect(verified.ok()).toBeTruthy();

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await logout(page);
  await expect(page).toHaveURL(/\/login$/);

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

  const createOwner = await page.request.post("/api/employees", {
    headers: { origin },
    data: { email: `${unique("owner-escalation")}@example.com`, password: employeePassword, role: "OWNER" },
  });
  expect(createOwner.status()).toBe(403);

  // Nouvelle session, isolée du cookie OWNER, connectée en tant qu'EMPLOYEE.
  const employeeContext = await page.context().browser()!.newContext();
  const employeePage = await employeeContext.newPage();
  try {
    await employeePage.goto("/login");
    await employeePage.getByLabel("Email").fill(employeeEmail);
    await employeePage.getByLabel("Mot de passe").fill(employeePassword);
    await employeePage.getByRole("button", { name: "Se connecter" }).click();
    await expect(employeePage).toHaveURL(/\/s$/);

    await employeePage.goto("/dashboard");
    await expect(employeePage).toHaveURL(/\/s$/);

    await employeePage.goto("/dashboard/clients");
    await expect(employeePage).toHaveURL(/\/s$/);

    await employeePage.goto("/dashboard/program");
    await expect(employeePage).toHaveURL(/\/s$/);

    await employeePage.goto("/dashboard/employees");
    await expect(employeePage).toHaveURL(/\/s$/);

    await employeePage.goto("/dashboard/security");
    await expect(employeePage).toHaveURL(/\/dashboard\/security$/);
    await expect(employeePage.getByRole("link", { name: "Scanner" })).toBeVisible();
    await expect(employeePage.getByRole("link", { name: "Équipe" })).toHaveCount(0);
    await expect(employeePage.getByRole("link", { name: "Programme" })).toHaveCount(0);
    await expect(employeePage.getByRole("link", { name: "Facturation" })).toHaveCount(0);

    const dashboardApi = await employeePage.request.get("/api/dashboard");
    expect(dashboardApi.status()).toBe(403);

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

test("rôle : OWNER délègue à MANAGER avec limites fines et audit complet", async ({ page }) => {
  await createMerchant(page, "manager-boundary");
  const managerEmail = `${unique("manager")}@example.com`;
  const targetEmail = `${unique("manager-target")}@example.com`;
  const password = "Password-test-123!";

  const managerResponse = await page.request.post("/api/employees", {
    headers: { origin },
    data: { email: managerEmail, password, role: "MANAGER" },
  });
  expect(managerResponse.status()).toBe(201);
  const manager = await managerResponse.json();

  const targetResponse = await page.request.post("/api/employees", {
    headers: { origin },
    data: { email: targetEmail, password, role: "EMPLOYEE" },
  });
  expect(targetResponse.status()).toBe(201);
  const target = await targetResponse.json();

  const employees = await page.request.get("/api/employees").then((response) => response.json());
  const owner = employees.find((employee: { role: string }) => employee.role === "OWNER");
  expect(owner).toBeTruthy();

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  const managerContext = await page.context().browser()!.newContext();
  const managerPage = await managerContext.newPage();
  try {
    const [managerCreatedAudit] = await sql`
      select action,metadata from audit_logs
      where entity_type='staff_user' and entity_id=${manager.id}
      order by created_at desc limit 1
    `;
    expect(managerCreatedAudit.action).toBe("STAFF_CREATE");
    expect(managerCreatedAudit.metadata).toMatchObject({ role: "MANAGER", active: true });

    await managerPage.goto("/login");
    await managerPage.getByLabel("Email").fill(managerEmail);
    await managerPage.getByLabel("Mot de passe").fill(password);
    await managerPage.getByRole("button", { name: "Se connecter" }).click();
    await expect(managerPage).toHaveURL(/\/dashboard$/);

    const managerCreatesEmployee = await managerPage.request.post("/api/employees", {
      headers: { origin },
      data: { email: `${unique("manager-child")}@example.com`, password, role: "EMPLOYEE" },
    });
    expect(managerCreatesEmployee.status()).toBe(201);

    const managerCreatesManager = await managerPage.request.post("/api/employees", {
      headers: { origin },
      data: { email: `${unique("manager-escalation")}@example.com`, password, role: "MANAGER" },
    });
    expect(managerCreatesManager.status()).toBe(403);

    const promoteToManager = await managerPage.request.patch(`/api/employees/${target.id}`, {
      headers: { origin },
      data: { role: "MANAGER" },
    });
    expect(promoteToManager.status()).toBe(403);

    const disableEmployee = await managerPage.request.patch(`/api/employees/${target.id}`, {
      headers: { origin },
      data: { active: false },
    });
    expect(disableEmployee.ok()).toBeTruthy();

    const [disableAudit] = await sql`
      select action,metadata from audit_logs
      where entity_type='staff_user' and entity_id=${target.id}
      order by created_at desc limit 1
    `;
    expect(disableAudit.action).toBe("STAFF_UPDATE");
    expect(disableAudit.metadata).toMatchObject({
      previousRole: "EMPLOYEE",
      role: "EMPLOYEE",
      previousActive: true,
      active: false,
      activeChanged: true,
      roleChanged: false,
    });

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

    const billingAsManager = await managerPage.request.post("/api/billing/checkout", {
      headers: { origin },
      data: { plan: "MONTHLY" },
    });
    expect(billingAsManager.status()).toBe(403);

    const ownerDemotesManager = await page.request.patch(`/api/employees/${manager.id}`, {
      headers: { origin },
      data: { role: "EMPLOYEE" },
    });
    expect(ownerDemotesManager.ok()).toBeTruthy();

    const [roleAudit] = await sql`
      select action,metadata from audit_logs
      where entity_type='staff_user' and entity_id=${manager.id}
      order by created_at desc limit 1
    `;
    expect(roleAudit.action).toBe("STAFF_UPDATE");
    expect(roleAudit.metadata).toMatchObject({
      previousRole: "MANAGER",
      role: "EMPLOYEE",
      roleChanged: true,
    });

    // Le changement de rôle révoque immédiatement l'ancienne session MANAGER.
    expect((await managerPage.request.get("/api/dashboard")).status()).toBe(401);
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
    await expect(employeePage).toHaveURL(/\/s$/);

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
    await expect(employeePage).toHaveURL(/\/s$/);

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


test("rôle : la base garantit un seul OWNER par établissement", async ({ page }) => {
  await createMerchant(page, "single-owner");
  const employees = await page.request.get("/api/employees").then((response) => response.json());
  const owner = employees.find((employee: { role: string }) => employee.role === "OWNER");
  expect(owner).toBeTruthy();

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await expect(
      sql`
        insert into staff_users(establishment_id,email,password_hash,role)
        select establishment_id,${`${unique("duplicate-owner")}@example.com`},'not-used','OWNER'
        from staff_users where id=${owner.id}
      `,
    ).rejects.toMatchObject({ code: "23505" });
  } finally {
    await sql.end({ timeout: 5 });
  }
});
