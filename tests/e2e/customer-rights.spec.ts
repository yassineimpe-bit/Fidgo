import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { createMerchant, origin, testClientIp, unique } from "./helpers";

async function enrollWithMarketing(page: Page, firstName: string, email: string) {
  const joinPath = await page.locator("code").filter({ hasText: "/j/" }).textContent();
  await page.goto(joinPath!);
  await page.getByLabel(/Prénom/).fill(firstName);
  await page.getByLabel(/Email/).fill(email);
  await page.getByRole("checkbox", { name: /offres et actualités de ce commerce/ }).check();
  await page.getByRole("button", { name: "Créer ma carte" }).click();
  await expect(page).toHaveURL(/\/c\//);
}

/**
 * Un navigateur qui a déjà une carte chez ce commerce est renvoyé vers elle
 * par /j/ (clé `loyalty:<slug>`) : le second client passe donc par l'API,
 * avec sa propre IP logique pour ne pas entamer le quota d'inscription partagé.
 */
async function enrollWithMarketingViaApi(page: Page, firstName: string, email: string) {
  const joinPath = await page.locator("code").filter({ hasText: "/j/" }).textContent();
  const slug = joinPath!.replace(/^\/j\//, "");
  const response = await page.request.post("/api/enroll", {
    headers: { origin, "x-real-ip": testClientIp() },
    data: { slug, firstName, email, marketingConsent: true },
  });
  expect(response.status()).toBe(201);
}

async function openCustomer(page: Page, firstName: string) {
  await page.goto("/dashboard/clients");
  await page.getByRole("link", { name: firstName }).click();
  await page.waitForURL(/\/dashboard\/clients\/[0-9a-f-]+$/);
  return new URL(page.url()).pathname.split("/").at(-1)!;
}

test("droits client : rectification et retrait du consentement marketing, audités sans valeur", async ({ page }) => {
  await createMerchant(page, "customer-rights");
  const email = `${unique("rights")}@example.com`;
  const rectified = `${unique("rights-new")}@example.com`;
  await page.goto("/dashboard");
  await enrollWithMarketing(page, "Inès", email);
  await page.goto("/dashboard");
  const customerId = await openCustomer(page, "Inès");
  const url = `/api/customers/${customerId}`;

  await page.getByLabel("Prénom").fill("Ines");
  await page.getByLabel("E-mail").fill(rectified);
  await page.getByLabel("Téléphone").fill("06 12 34 56 78");
  await page.getByRole("button", { name: "Rectifier les coordonnées" }).click();
  await expect(page.getByRole("status")).toHaveText("Coordonnées rectifiées.");
  await page.reload();
  await expect(page.getByLabel("E-mail")).toHaveValue(rectified);
  await expect(page.getByRole("heading", { name: "Ines" })).toBeVisible();

  // expect.poll relance la lecture si la réponse est libérée par une navigation en cours.
  await expect.poll(async () => (await (await page.request.get(`${url}/export`)).json()).customer)
    .toMatchObject({ first_name: "Ines", email: rectified, phone: "06 12 34 56 78", marketing_consent: true });

  // Le commerce ne peut pas consentir à la place du client, ni saisir n'importe quoi.
  expect((await page.request.patch(url, { headers: { origin }, data: { marketingConsent: true } })).status()).toBe(400);
  expect((await page.request.patch(url, { headers: { origin }, data: { email: "" } })).status()).toBe(400);
  expect((await page.request.patch(url, { headers: { origin }, data: { phone: "appelle-moi" } })).status()).toBe(400);

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Retirer le consentement marketing" }).click();
  await expect(page.getByRole("status")).toHaveText("Consentement marketing retiré.");
  await expect(page.getByRole("button", { name: "Retirer le consentement marketing" })).toHaveCount(0);
  await expect(page.getByText("Non consenti")).toBeVisible();

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const [row] = await sql`select first_name,email,phone,marketing_consent,marketing_consent_at from customers where id=${customerId}`;
    expect(row).toMatchObject({ first_name: "Ines", email: rectified, phone: "06 12 34 56 78", marketing_consent: false, marketing_consent_at: null });
    const audits = await sql`
      select action,metadata from audit_logs
      where entity_type='customer' and entity_id=${customerId}
        and action in ('CUSTOMER_CONTACT_UPDATED','CUSTOMER_MARKETING_WITHDRAWN')
      order by created_at
    `;
    expect(audits.map((audit) => audit.action)).toEqual(["CUSTOMER_CONTACT_UPDATED", "CUSTOMER_MARKETING_WITHDRAWN"]);
    expect(audits[0].metadata).toEqual({ fields: ["firstName", "email", "phone"] });
    const serialized = JSON.stringify(audits);
    for (const value of [email, rectified, "Inès", "Ines", "06 12"]) expect(serialized).not.toContain(value);
  } finally {
    await sql.end({ timeout: 5 });
  }

  // Une requête identique ne crée ni écriture ni audit supplémentaire.
  const again = await page.request.patch(url, { headers: { origin }, data: { firstName: "Ines", marketingConsent: false } });
  expect(await again.json()).toMatchObject({ ok: true, changed: [], marketingWithdrawn: false });
});

test("droits client : unicité par commerce, rôles et isolation tenant", async ({ page }) => {
  await createMerchant(page, "rights-tenant-a");
  const first = `${unique("rights-a1")}@example.com`;
  const second = `${unique("rights-a2")}@example.com`;
  await page.goto("/dashboard");
  await enrollWithMarketing(page, "Alma", first);
  await page.goto("/dashboard");
  await enrollWithMarketingViaApi(page, "Basile", second);
  await page.goto("/dashboard");
  const customerId = await openCustomer(page, "Basile");
  const url = `/api/customers/${customerId}`;

  const clash = await page.request.patch(url, { headers: { origin }, data: { email: first.toUpperCase() } });
  expect(clash.status()).toBe(409);
  expect((await clash.json()).error).toBe("CONTACT_ALREADY_USED");

  const employeeEmail = `${unique("rights-employee")}@example.com`;
  const password = "Password-test-123!";
  expect((await page.request.post("/api/employees", {
    headers: { origin }, data: { email: employeeEmail, password, role: "EMPLOYEE" },
  })).ok()).toBeTruthy();
  // Une IP logique par connexion : le quota login (10/15 min par IP) est partagé par toute la suite.
  const employeeContext = await page.context().browser()!.newContext({ extraHTTPHeaders: { "x-real-ip": testClientIp() } });
  const employeePage = await employeeContext.newPage();
  try {
    await employeePage.goto("/login");
    await employeePage.getByLabel("Email").fill(employeeEmail);
    await employeePage.getByLabel("Mot de passe").fill(password);
    await employeePage.getByRole("button", { name: "Se connecter" }).click();
    await expect(employeePage).toHaveURL(/\/s$/);
    expect((await employeePage.request.patch(url, { headers: { origin }, data: { marketingConsent: false } })).status()).toBe(403);
  } finally {
    await employeeContext.close();
  }

  const otherContext = await page.context().browser()!.newContext();
  const otherPage = await otherContext.newPage();
  try {
    await createMerchant(otherPage, "rights-tenant-b");
    expect((await otherPage.request.patch(url, { headers: { origin }, data: { firstName: "IDOR" } })).status()).toBe(404);
  } finally {
    await otherContext.close();
  }

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const [row] = await sql`select first_name,email,marketing_consent from customers where id=${customerId}`;
    expect(row).toMatchObject({ first_name: "Basile", email: second, marketing_consent: true });
  } finally {
    await sql.end({ timeout: 5 });
  }
});

test("commerçant : choix des nouveautés Retiko modifiable et daté", async ({ page }) => {
  await createMerchant(page, "staff-marketing");
  await page.goto("/dashboard/security");
  const checkbox = page.getByRole("checkbox", { name: /nouveautés et offres de Retiko/ });
  await expect(checkbox).not.toBeChecked();

  // La case ne change d'état qu'une fois le choix enregistré par le serveur.
  await checkbox.click();
  await expect(page.getByRole("status")).toHaveText("Tu recevras les nouveautés Retiko.");
  await expect(checkbox).toBeChecked();
  await page.reload();
  await expect(checkbox).toBeChecked();

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const email = await page.locator("text=Compte connecté :").textContent();
    const staffEmail = email!.replace("Compte connecté :", "").trim();
    const [granted] = await sql`select marketing_consent,marketing_consent_at from staff_users where email=${staffEmail}`;
    expect(granted.marketing_consent).toBe(true);
    expect(granted.marketing_consent_at).toBeTruthy();

    await checkbox.click();
    await expect(page.getByRole("status")).toHaveText("Tu ne recevras plus les nouveautés Retiko.");
    await expect(checkbox).not.toBeChecked();
    const [withdrawn] = await sql`select id,marketing_consent,marketing_consent_at from staff_users where email=${staffEmail}`;
    expect(withdrawn).toMatchObject({ marketing_consent: false, marketing_consent_at: null });
    const audits = await sql`
      select metadata from audit_logs
      where action='STAFF_MARKETING_CONSENT_UPDATED' and entity_id=${String(withdrawn.id)}
      order by created_at
    `;
    expect(audits.map((audit) => audit.metadata)).toEqual([{ consent: true }, { consent: false }]);
  } finally {
    await sql.end({ timeout: 5 });
  }

  expect((await page.request.patch("/api/account/marketing", { headers: { origin }, data: { marketingConsent: "yes" } })).status()).toBe(400);
});
