import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { createMerchant, enrollCustomer, origin, unique } from "./helpers";

test("note interne : modification, audit sans texte libre, export et effacement", async ({ page }) => {
  await createMerchant(page, "customer-note");
  await enrollCustomer(page, "Nora", `${unique("note")}@example.com`);
  await page.goto("/dashboard/clients");
  await page.getByRole("link", { name: "Nora" }).click();
  await page.waitForURL(/\/dashboard\/clients\/[0-9a-f-]+$/);
  const customerId = new URL(page.url()).pathname.split("/").at(-1)!;

  await page.getByLabel("Visible par l’équipe, jamais par le client.").fill("Préférence de visite le mardi");
  await page.getByRole("button", { name: "Enregistrer la note" }).click();
  await expect(page.getByRole("status")).toHaveText("Note enregistrée.");
  await page.reload();
  await expect(page.getByLabel("Visible par l’équipe, jamais par le client.")).toHaveValue("Préférence de visite le mardi");

  const exportResponse = await page.request.get(`/api/customers/${customerId}/export`);
  expect(exportResponse.ok()).toBeTruthy();
  expect((await exportResponse.json()).customer.internal_note).toBe("Préférence de visite le mardi");

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const audits = await sql`
      select metadata from audit_logs
      where entity_type='customer' and entity_id=${customerId} and action='CUSTOMER_NOTE_UPDATED'
    `;
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0].metadata)).not.toContain("Préférence");
  } finally {
    await sql.end({ timeout: 5 });
  }

  const erase = await page.request.delete(`/api/customers/${customerId}`, { headers: { origin } });
  expect(erase.ok()).toBeTruthy();
  expect((await page.request.patch(`/api/customers/${customerId}/note`, {
    headers: { origin }, data: { note: "recréée" },
  })).status()).toBe(404);
  const check = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const [row] = await check`select internal_note from customers where id=${customerId}`;
    expect(row.internal_note).toBeNull();
  } finally {
    await check.end({ timeout: 5 });
  }
});

test("note interne : OWNER/MANAGER seulement, tenant strict et validation serveur", async ({ page }) => {
  await createMerchant(page, "note-tenant-a");
  await enrollCustomer(page, "Aya", `${unique("note-a")}@example.com`);
  await page.goto("/dashboard/clients");
  await page.getByRole("link", { name: "Aya" }).click();
  await page.waitForURL(/\/dashboard\/clients\/[0-9a-f-]+$/);
  const customerId = new URL(page.url()).pathname.split("/").at(-1)!;
  const url = `/api/customers/${customerId}/note`;

  for (const note of ["<script>alert(1)</script>", "x".repeat(501), 42]) {
    const response = await page.request.patch(url, { headers: { origin }, data: { note } });
    expect(response.status()).toBe(400);
  }
  const employeeEmail = `${unique("note-employee")}@example.com`;
  const employeePassword = "Password-test-123!";
  expect((await page.request.post("/api/employees", {
    headers: { origin }, data: { email: employeeEmail, password: employeePassword, role: "EMPLOYEE" },
  })).ok()).toBeTruthy();

  const employeeContext = await page.context().browser()!.newContext();
  const employeePage = await employeeContext.newPage();
  try {
    await employeePage.goto("/login");
    await employeePage.getByLabel("Email").fill(employeeEmail);
    await employeePage.getByLabel("Mot de passe").fill(employeePassword);
    await employeePage.getByRole("button", { name: "Se connecter" }).click();
    await expect(employeePage).toHaveURL(/\/dashboard$/);
    expect((await employeePage.request.patch(url, { headers: { origin }, data: { note: "escalade" } })).status()).toBe(403);
    await employeePage.goto(`/dashboard/clients/${customerId}`);
    await expect(employeePage.getByRole("heading", { name: "Note interne" })).toBeVisible();
    await expect(employeePage.getByRole("button", { name: "Enregistrer la note" })).toHaveCount(0);
  } finally {
    await employeeContext.close();
  }

  const managerEmail = `${unique("note-manager")}@example.com`;
  expect((await page.request.post("/api/employees", {
    headers: { origin }, data: { email: managerEmail, password: employeePassword, role: "EMPLOYEE" },
  })).ok()).toBeTruthy();
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`update staff_users set role='MANAGER',updated_at=now() where email=${managerEmail}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
  const managerContext = await page.context().browser()!.newContext();
  const managerPage = await managerContext.newPage();
  try {
    await managerPage.goto("/login");
    await managerPage.getByLabel("Email").fill(managerEmail);
    await managerPage.getByLabel("Mot de passe").fill(employeePassword);
    await managerPage.getByRole("button", { name: "Se connecter" }).click();
    await expect(managerPage).toHaveURL(/\/dashboard$/);
    expect((await managerPage.request.patch(url, { headers: { origin }, data: { note: "Manager validé" } })).status()).toBe(200);
  } finally {
    await managerContext.close();
  }

  const otherContext = await page.context().browser()!.newContext();
  const otherPage = await otherContext.newPage();
  try {
    await createMerchant(otherPage, "note-tenant-b");
    expect((await otherPage.request.patch(url, { headers: { origin }, data: { note: "IDOR" } })).status()).toBe(404);
  } finally {
    await otherContext.close();
  }
});
