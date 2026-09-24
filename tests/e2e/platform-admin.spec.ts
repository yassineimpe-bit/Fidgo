import { expect, test, type Browser, type Page } from "@playwright/test";
import postgres from "postgres";
import { createMerchant, enrollCustomer, origin, testClientIp, unique } from "./helpers";

test.setTimeout(120_000);

const PASSWORD = "Password-test-123!";

function db() {
  return postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
}

async function ownerOf(page: Page) {
  const employees = await page.request.get("/api/employees").then((response) => response.json());
  const owner = employees.find((employee: { role: string }) => employee.role === "OWNER");
  expect(owner).toBeTruthy();
  const restaurant = await page.request.get("/api/restaurant").then((response) => response.json());
  return { staffId: String(owner.id), email: String(owner.email), establishmentId: String(restaurant.id), slug: String(restaurant.slug), name: String(restaurant.name) };
}

async function merchantInNewContext(browser: Browser, label: string) {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": testClientIp() } });
  const page = await context.newPage();
  await createMerchant(page, label);
  return { context, page, ...(await ownerOf(page)) };
}

function suspension(page: Page, establishmentId: string, data: Record<string, unknown>, headers: Record<string, string> = { origin }) {
  return page.request.post(`/api/admin/establishments/${establishmentId}/suspension`, { headers, data });
}

test("super-admin : invisible et inutilisable pour un commerçant ordinaire", async ({ page }) => {
  await createMerchant(page, "not-admin");
  const me = await ownerOf(page);
  for (const path of ["/admin", "/admin/establishments", "/admin/users", "/admin/subscriptions", "/admin/audit", `/admin/establishments/${me.establishmentId}`]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
  }
  const attempt = await suspension(page, me.establishmentId, { action: "suspend", reason: "Tentative sans droits admin", confirmationSlug: me.slug });
  expect(attempt.status()).toBe(404);
});

test("super-admin : recherche, suspension réversible, audit append-only et révocation", async ({ page, browser }) => {
  await createMerchant(page, "platform-admin");
  const admin = await ownerOf(page);
  const target = await merchantInNewContext(browser, "admin-target");
  const closed = await merchantInNewContext(browser, "admin-closed");
  const sql = db();
  try {
    await sql`insert into platform_admins(staff_user_id, note) values(${admin.staffId}, 'e2e')`;

    const { cardUrl } = await enrollCustomer(target.page, "Nadia", `${unique("admin-card")}@example.com`);
    await target.page.goto("/dashboard");

    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Vue d’ensemble" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "État des services" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Volume de scans · 14 jours" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Erreurs" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Activité récente" })).toBeVisible();

    await page.goto(`/admin/establishments?q=${encodeURIComponent(target.slug)}`);
    await expect(page.getByRole("link", { name: target.name })).toBeVisible();
    await expect(page.getByText(closed.name)).toHaveCount(0);
    await page.goto(`/admin/establishments?q=${encodeURIComponent("%")}`);
    await expect(page.getByText("Aucun commerce trouvé.")).toBeVisible();

    await page.goto(`/admin/users?q=${encodeURIComponent(target.email)}`);
    await expect(page.getByRole("cell", { name: target.email })).toBeVisible();
    await page.goto("/admin/subscriptions");
    await expect(page.getByRole("heading", { name: "Répartition" })).toBeVisible();

    // Même exigence que le dashboard : aucun défilement horizontal sur téléphone.
    const viewport = page.viewportSize()!;
    await page.setViewportSize({ width: 320, height: 800 });
    for (const path of ["/admin", "/admin/establishments", "/admin/users", "/admin/subscriptions", "/admin/audit", `/admin/establishments/${target.establishmentId}`]) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} @320px`).toBe(0);
    }
    await page.setViewportSize(viewport);

    // Garde-fous API.
    expect((await suspension(page, target.establishmentId, { action: "suspend", reason: "Motif valide mais origine tierce", confirmationSlug: target.slug }, { origin: "https://evil.example" })).status()).toBe(403);
    expect((await suspension(page, target.establishmentId, { action: "suspend", reason: "court", confirmationSlug: target.slug })).status()).toBe(400);
    expect((await suspension(page, admin.establishmentId, { action: "suspend", reason: "Tentative d'auto-suspension", confirmationSlug: admin.slug })).status()).toBe(409);
    expect((await suspension(page, target.establishmentId, { action: "reactivate", reason: "Rien à réactiver ici", confirmationSlug: target.slug })).status()).toBe(409);

    // Suspension depuis l'interface, avec confirmation par slug.
    await page.goto(`/admin/establishments/${target.establishmentId}`);
    const suspendForm = page.getByRole("form", { name: "Suspendre le commerce" });
    await suspendForm.getByLabel("Motif (journalisé)").fill("Impayé après trois relances");
    await suspendForm.getByLabel(/Tape le slug/).fill("mauvais-slug");
    await suspendForm.getByRole("button", { name: "Suspendre le commerce" }).click();
    await expect(suspendForm.getByRole("alert")).toContainText("CONFIRMATION_MISMATCH");
    await suspendForm.getByLabel(/Tape le slug/).fill(target.slug);
    await suspendForm.getByRole("button", { name: "Suspendre le commerce" }).click();
    await expect(page.getByText(/Suspendu par Retiko le .*Impayé après trois relances/)).toBeVisible();

    // Effet immédiat : session staff, carte client et page d'inscription coupées.
    await target.page.goto("/dashboard");
    await expect(target.page).toHaveURL(/\/login$/);
    expect((await target.page.goto(cardUrl))?.status()).toBe(404);
    expect((await target.page.goto(`/j/${target.slug}`))?.status()).toBe(404);
    const blockedLogin = await target.page.request.post("/api/auth/login", { headers: { origin }, data: { email: target.email, password: PASSWORD } });
    expect(blockedLogin.status()).toBe(403);
    expect((await blockedLogin.json()).error).toBe("ESTABLISHMENT_SUSPENDED");
    expect(blockedLogin.headers()["set-cookie"]).toBeUndefined();
    // Sans le bon mot de passe, rien ne distingue un commerce suspendu d'un mauvais identifiant.
    const wrongPassword = await target.page.request.post("/api/auth/login", { headers: { origin }, data: { email: target.email, password: "Wrong-password-123!" } });
    expect(wrongPassword.status()).toBe(401);
    expect((await wrongPassword.json()).error).toBe("INVALID_CREDENTIALS");
    await target.page.goto("/login");
    await target.page.getByLabel("Email").fill(target.email);
    await target.page.getByLabel("Mot de passe").fill(PASSWORD);
    await target.page.getByRole("button", { name: "Se connecter" }).click();
    await expect(target.page.getByText("Ce commerce est suspendu. Contacte le support Retiko pour le réactiver.", { exact: false })).toBeVisible();
    await expect(target.page).toHaveURL(/\/login$/);

    const [suspendAudit] = await sql`
      select admin_email, reason from platform_admin_audit
      where action='PLATFORM_SUSPEND' and target_id=${target.establishmentId}
    `;
    expect(suspendAudit).toMatchObject({ admin_email: admin.email, reason: "Impayé après trois relances" });
    await expect(sql`update platform_admin_audit set reason='effacé' where target_id=${target.establishmentId}`).rejects.toMatchObject({ code: "55000" });
    await expect(sql`delete from platform_admin_audit where target_id=${target.establishmentId}`).rejects.toMatchObject({ code: "55000" });

    // Réactivation : même carte, même compte, nouvelle connexion obligatoire.
    await page.getByRole("form", { name: "Réactiver le commerce" }).getByLabel("Motif (journalisé)").fill("Paiement régularisé par virement");
    await page.getByRole("form", { name: "Réactiver le commerce" }).getByLabel(/Tape le slug/).fill(target.slug);
    await page.getByRole("button", { name: "Réactiver le commerce" }).click();
    await expect(page.getByRole("form", { name: "Suspendre le commerce" })).toBeVisible();
    expect((await target.page.goto(cardUrl))?.status()).toBe(200);
    const login = await target.page.request.post("/api/auth/login", { headers: { origin }, data: { email: target.email, password: PASSWORD } });
    expect(login.ok()).toBeTruthy();
    await target.page.goto("/dashboard");
    await expect(target.page).toHaveURL(/\/dashboard$/);

    // Une fermeture demandée par le commerçant n'est pas réversible par le super-admin.
    const selfClose = await closed.page.request.post("/api/restaurant/suspend", { headers: { origin }, data: { confirmation: "SUSPENDRE", confirmationSlug: closed.slug } });
    expect(selfClose.ok()).toBeTruthy();
    expect((await suspension(page, closed.establishmentId, { action: "reactivate", reason: "Tentative de réouverture", confirmationSlug: closed.slug })).status()).toBe(409);

    await page.goto("/admin/audit");
    const targetRows = page.getByRole("row").filter({ hasText: target.name });
    await expect(targetRows.filter({ hasText: "Suspension commerce" }).filter({ hasText: "Impayé après trois relances" })).toHaveCount(1);
    await expect(targetRows.filter({ hasText: "Réactivation commerce" }).filter({ hasText: "Paiement régularisé par virement" })).toHaveCount(1);
    const [views] = await sql`select count(*)::int as count from platform_admin_audit where admin_staff_user_id=${admin.staffId} and action='ADMIN_VIEW'`;
    expect(views.count).toBeGreaterThan(5);

    // Retrait des droits : effet immédiat, sans attendre l'expiration de la session.
    await sql`delete from platform_admins where staff_user_id=${admin.staffId}`;
    expect((await page.goto("/admin"))?.status()).toBe(404);
  } finally {
    await sql`delete from platform_admins where staff_user_id=${admin.staffId}`;
    await sql.end({ timeout: 5 });
    await target.context.close();
    await closed.context.close();
  }
});
