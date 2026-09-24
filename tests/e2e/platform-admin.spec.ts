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

const MOBILE_WIDTHS = [320, 375, 390, 430];

/** scrollWidth ≤ clientWidth ET innerWidth = largeur réelle : un débordement élargit innerWidth en émulation mobile. */
async function expectNoHorizontalOverflow(page: Page, label: string) {
  const layout = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    innerWidth: window.innerWidth,
  }));
  expect(layout.overflow, `${label} : débordement`).toBeLessThanOrEqual(0);
  expect(layout.innerWidth, `${label} : innerWidth`).toBe(page.viewportSize()!.width);
}

/**
 * 320 px (pire cas) : toutes les pages. 375/390/430 : fiche commerce + navigation.
 * Volontairement sobre : chaque rendu admin interroge toute la base, et une
 * boucle exhaustive ralentissait le serveur dev au point de gêner la spec suivante.
 */
async function expectAdminUsableOnPhones(page: Page, allPaths: string[], detailPath: string, criticalButton: string, checkNavigation = true) {
  const viewport = page.viewportSize()!;
  try {
    for (const width of MOBILE_WIDTHS) {
      await page.setViewportSize({ width, height: 800 });
      const paths = width === MOBILE_WIDTHS[0] ? [...allPaths.filter((path) => path !== detailPath), detailPath] : [detailPath];
      for (const path of paths) {
        await page.goto(path);
        await expectNoHorizontalOverflow(page, `${path} @${width}px`);
      }
      const button = page.getByRole("button", { name: criticalButton });
      await expect(button, `${criticalButton} @${width}px`).toBeVisible();
      await button.click({ trial: true });
      if (checkNavigation) {
        await page.getByRole("navigation", { name: "Navigation super-admin" }).getByRole("link", { name: "Commerces" }).click();
        await expect(page).toHaveURL(/\/admin\/establishments$/);
        await expectNoHorizontalOverflow(page, `/admin/establishments via navigation @${width}px`);
      }
    }
  } finally {
    await page.setViewportSize(viewport);
  }
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
    const cardToken = new URL(cardUrl).pathname.split("/").at(-1)!;
    const credit = await target.page.request.post("/api/credit", { headers: { origin }, data: { token: `LOY1:${cardToken}`, idempotencyKey: crypto.randomUUID() } });
    expect(credit.ok()).toBeTruthy();
    await target.page.goto("/dashboard");
    const snapshot = () => sql`
      select c.token, c.short_code, c.balance, c.active,
        (select count(*)::int from transactions t where t.establishment_id=${target.establishmentId}) as ledger,
        (select coalesce(sum(delta),0)::int from transactions t where t.establishment_id=${target.establishmentId}) as ledger_sum,
        (select count(*)::int from customers u where u.establishment_id=${target.establishmentId} and u.deleted_at is null) as customers,
        (select count(*)::int from staff_users s where s.establishment_id=${target.establishmentId} and s.active) as active_staff
      from cards c where c.establishment_id=${target.establishmentId}
    `.then((rows) => rows.map((row) => ({ ...row })));
    const before = await snapshot();
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ ledger: 1, ledger_sum: 1, balance: 1, active: true });

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

    // Même exigence que le dashboard : aucun défilement horizontal de 320 à 430 px.
    const adminPaths = ["/admin", "/admin/establishments", "/admin/users", "/admin/subscriptions", "/admin/audit", `/admin/establishments/${target.establishmentId}`];
    await expectAdminUsableOnPhones(page, adminPaths, `/admin/establishments/${target.establishmentId}`, "Suspendre le commerce");

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

    // Aucune donnée supprimée, ledger intact, carte non régénérée.
    expect(await snapshot()).toEqual(before);
    const [establishmentRow] = await sql`select status, platform_suspended_at is not null as platform from establishments where id=${target.establishmentId}`;
    expect(establishmentRow).toMatchObject({ status: "suspended", platform: true });

    // Effet immédiat : session staff, carte client, inscription et API publiques coupées.
    expect((await target.page.request.get(`/api/card/${cardToken}`)).status()).toBe(404);
    const enrollDuringSuspension = await target.page.request.post("/api/enroll", { headers: { origin }, data: { slug: target.slug, firstName: "Luc", email: `${unique("suspended-enroll")}@example.com` } });
    expect(enrollDuringSuspension.status()).toBe(404);
    await target.page.goto("/dashboard");
    await expect(target.page).toHaveURL(/\/login$/);
    expect((await target.page.goto(cardUrl))?.status()).toBe(404);
    expect((await target.page.goto(`/j/${target.slug}`))?.status()).toBe(404);
    const blockedLogin = await target.page.request.post("/api/auth/login", { headers: { origin, "x-real-ip": testClientIp() }, data: { email: target.email, password: PASSWORD } });
    expect(blockedLogin.status()).toBe(403);
    expect((await blockedLogin.json()).error).toBe("ESTABLISHMENT_SUSPENDED");
    expect(blockedLogin.headers()["set-cookie"]).toBeUndefined();
    // Sans le bon mot de passe, rien ne distingue un commerce suspendu d'un mauvais identifiant.
    const wrongPassword = await target.page.request.post("/api/auth/login", { headers: { origin, "x-real-ip": testClientIp() }, data: { email: target.email, password: "Wrong-password-123!" } });
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

    await expectAdminUsableOnPhones(page, [], `/admin/establishments/${target.establishmentId}`, "Réactiver le commerce", false);
    await page.goto(`/admin/establishments/${target.establishmentId}`);

    // Réactivation : même carte, même compte, nouvelle connexion obligatoire.
    await page.getByRole("form", { name: "Réactiver le commerce" }).getByLabel("Motif (journalisé)").fill("Paiement régularisé par virement");
    await page.getByRole("form", { name: "Réactiver le commerce" }).getByLabel(/Tape le slug/).fill(target.slug);
    await page.getByRole("button", { name: "Réactiver le commerce" }).click();
    await expect(page.getByRole("form", { name: "Suspendre le commerce" })).toBeVisible();
    expect((await target.page.goto(cardUrl))?.status()).toBe(200);
    expect(await snapshot()).toEqual(before);
    const login = await target.page.request.post("/api/auth/login", { headers: { origin, "x-real-ip": testClientIp() }, data: { email: target.email, password: PASSWORD } });
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

    // Session : un changement de mot de passe (token_version) tue la session privilégiée.
    await sql`insert into platform_admins(staff_user_id, note) values(${admin.staffId}, 'e2e')`;
    expect((await page.goto("/admin"))?.status()).toBe(200);
    await sql`update staff_users set token_version=token_version+1 where id=${admin.staffId}`;
    expect((await page.goto("/admin"))?.status()).toBe(404);
    const relogin = await page.request.post("/api/auth/login", { headers: { origin, "x-real-ip": testClientIp() }, data: { email: admin.email, password: PASSWORD } });
    expect(relogin.ok()).toBeTruthy();
    expect((await page.goto("/admin"))?.status()).toBe(200);

    // Compte super-admin désactivé : plus d'accès, même avec une session encore signée.
    await sql`update staff_users set active=false where id=${admin.staffId}`;
    expect((await page.goto("/admin"))?.status()).toBe(404);
    expect((await suspension(page, target.establishmentId, { action: "suspend", reason: "Tentative après désactivation", confirmationSlug: target.slug })).status()).toBe(404);
    expect((await page.request.post("/api/auth/login", { headers: { origin, "x-real-ip": testClientIp() }, data: { email: admin.email, password: PASSWORD } })).status()).toBe(401);
  } finally {
    await sql`delete from platform_admins where staff_user_id=${admin.staffId}`;
    await sql.end({ timeout: 5 });
    await target.context.close();
    await closed.context.close();
  }
});
