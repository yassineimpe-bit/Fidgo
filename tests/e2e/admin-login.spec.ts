import { expect, test, type Browser, type Page } from "@playwright/test";
import postgres from "postgres";
import { base32Decode, totpCode, totpStep } from "../../lib/totp";
import { createMerchant, origin, testClientIp, unique } from "./helpers";

// Connexion dédiée /admin (#256) : réservée à platform_admins, réponses
// génériques pour tout autre compte, contexte admin conservé et revérifié
// jusqu'au second facteur.
test.describe.configure({ timeout: 180_000 });

const PASSWORD = "Password-test-123!";
const GENERIC_ERROR = "Email ou mot de passe incorrect. (INVALID_CREDENTIALS)";

function db() {
  return postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
}

async function merchant(browser: Browser, label: string) {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": testClientIp() } });
  const page = await context.newPage();
  await createMerchant(page, label);
  const employees = await page.request.get("/api/employees").then((response) => response.json());
  const owner = employees.find((employee: { role: string }) => employee.role === "OWNER");
  return { context, page, staffId: String(owner.id), email: String(owner.email) };
}

async function anonymous(browser: Browser) {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": testClientIp() } });
  return { context, page: await context.newPage() };
}

async function expectAdminLoginOnly(page: Page) {
  const response = await page.goto("/admin");
  expect(response?.status()).toBe(200);
  expect(response?.headers()["cache-control"]).toContain("no-store");
  await expect(page.getByRole("heading", { name: "Connexion administrateur" })).toBeVisible();
  await expect(page.getByText("Retiko · Super-admin").first()).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Navigation super-admin" })).toHaveCount(0);
}

async function submitAdminPassword(page: Page, email: string, password: string) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
}

function adminApiLogin(page: Page, email: string, password: string) {
  return page.request.post("/api/auth/login", {
    headers: { origin, "x-real-ip": testClientIp() },
    data: { email, password, scope: "admin" },
  });
}

test("admin : formulaire dédié, refus génériques, accès, journal et révocation", async ({ browser }) => {
  const admin = await merchant(browser, "admin-login");
  const staff = await merchant(browser, "admin-login-staff");
  const sql = db();
  const visitor = await anonymous(browser);
  try {
    await sql`insert into platform_admins(staff_user_id, note) values(${admin.staffId}, 'e2e')`;

    // A. Non connecté : connexion super-admin, sans inscription ni marketing.
    await expectAdminLoginOnly(visitor.page);
    await expect(visitor.page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex.*nofollow/);
    await expect(visitor.page.getByRole("link", { name: /Créer|inscri/i })).toHaveCount(0);

    // C/D/E. Mauvais mot de passe, compte inexistant, staff valide non admin :
    // même réponse HTTP, même message.
    const responses = await Promise.all([
      adminApiLogin(visitor.page, admin.email, "Wrong-password-123!"),
      adminApiLogin(visitor.page, `${unique("nobody")}@example.com`, PASSWORD),
      adminApiLogin(visitor.page, staff.email, PASSWORD),
    ]);
    for (const response of responses) {
      expect(response.status()).toBe(401);
      expect(await response.json()).toEqual({ error: "INVALID_CREDENTIALS" });
    }
    for (const [email, password] of [[admin.email, "Wrong-password-123!"], [`${unique("nobody")}@example.com`, PASSWORD], [staff.email, PASSWORD]]) {
      await submitAdminPassword(visitor.page, email, password);
      await expect(visitor.page.locator(".notice[role=alert]")).toHaveText(GENERIC_ERROR, { timeout: 15_000 });
    }
    // Aucune session pour le staff non admin, et toujours aucune donnée admin.
    expect((await visitor.context.cookies()).find((cookie) => cookie.name === "loyalty_staff")).toBeUndefined();
    await expectAdminLoginOnly(visitor.page);

    // Contrôle d'origine conservé.
    const foreign = await visitor.page.request.post("/api/auth/login", {
      headers: { origin: "https://evil.example", "x-real-ip": testClientIp() },
      data: { email: admin.email, password: PASSWORD, scope: "admin" },
    });
    expect(foreign.status()).toBe(403);

    // B. Admin valide : directement sur le cockpit, connexion journalisée.
    await submitAdminPassword(visitor.page, admin.email, PASSWORD);
    await expect(visitor.page).toHaveURL(/\/admin$/, { timeout: 15_000 });
    await expect(visitor.page.getByRole("navigation", { name: "Navigation super-admin" })).toBeVisible({ timeout: 15_000 });
    const [login] = await sql`
      select metadata from platform_admin_audit
      where admin_staff_user_id=${admin.staffId} and action='ADMIN_LOGIN' order by created_at desc limit 1
    `;
    expect(login.metadata).toEqual({ method: "password" });
    expect(JSON.stringify(login.metadata)).not.toContain(PASSWORD);

    // H. Révocation : effet au chargement suivant, sans attendre la session.
    await sql`delete from platform_admins where staff_user_id=${admin.staffId}`;
    await expectAdminLoginOnly(visitor.page);
    expect((await visitor.page.goto("/admin/establishments"))?.status()).toBe(404);
  } finally {
    await sql`delete from platform_admins where staff_user_id=${admin.staffId}`;
    await sql.end({ timeout: 5 });
    await Promise.all([admin.context.close(), staff.context.close(), visitor.context.close()]);
  }
});

test("admin : session commerçant non admin sur /admin, login commerçant inchangé", async ({ browser }) => {
  const staff = await merchant(browser, "admin-merchant");
  const admin = await merchant(browser, "admin-merchant-admin");
  const sql = db();
  try {
    await sql`insert into platform_admins(staff_user_id, note) values(${admin.staffId}, 'e2e')`;

    // I. Commerçant connecté : formulaire admin, aucune donnée, session intacte.
    await expectAdminLoginOnly(staff.page);
    expect((await staff.page.request.get("/api/restaurant")).status()).toBe(200);

    // Admin déjà connecté (session ouverte par l'inscription) : cockpit direct.
    await admin.page.goto("/admin");
    await expect(admin.page.getByRole("navigation", { name: "Navigation super-admin" })).toBeVisible({ timeout: 15_000 });

    // J. /login reste l'entrée commerçant, y compris pour un super-admin.
    for (const email of [staff.email, admin.email]) {
      const fresh = await anonymous(browser);
      try {
        await fresh.page.goto("/login");
        await fresh.page.getByLabel("Email").fill(email);
        await fresh.page.getByLabel("Mot de passe").fill(PASSWORD);
        await fresh.page.getByRole("button", { name: "Se connecter" }).click();
        await expect(fresh.page).toHaveURL(/\/(onboarding|dashboard)$/, { timeout: 15_000 });
      } finally {
        await fresh.context.close();
      }
    }
  } finally {
    await sql`delete from platform_admins where staff_user_id=${admin.staffId}`;
    await sql.end({ timeout: 5 });
    await Promise.all([staff.context.close(), admin.context.close()]);
  }
});

test("admin : 2FA jusqu'au cockpit, refus si l'accès est retiré avant le code", async ({ browser }) => {
  const admin = await merchant(browser, "admin-2fa");
  const sql = db();
  try {
    await sql`insert into platform_admins(staff_user_id, note) values(${admin.staffId}, 'e2e')`;
    const page = admin.page;
    await page.goto("/dashboard/security");
    await page.getByRole("button", { name: "Activer la double authentification" }).click();
    await page.locator("#two-factor-password").fill(PASSWORD);
    await page.getByRole("button", { name: "Continuer" }).click();
    const secret = (await page.getByTestId("two-factor-secret").textContent({ timeout: 15_000 }))!.trim();
    const enabledStep = totpStep();
    await page.getByLabel("2. Code à 6 chiffres affiché par l’application").fill(totpCode(base32Decode(secret)!, enabledStep));
    await page.getByRole("button", { name: "Activer la double authentification" }).click();
    await page.getByRole("button", { name: "J’ai enregistré mes codes" }).click();

    // F. Mot de passe, challenge, code valide : cockpit.
    const first = await anonymous(browser);
    try {
      await expectAdminLoginOnly(first.page);
      await submitAdminPassword(first.page, admin.email, PASSWORD);
      await expect(first.page.getByLabel("Code de vérification")).toBeVisible({ timeout: 15_000 });
      expect((await first.page.request.get("/api/restaurant")).status()).toBe(401);
      await first.page.getByLabel("Code de vérification").fill(totpCode(base32Decode(secret)!, enabledStep + 1));
      await first.page.getByRole("button", { name: "Vérifier" }).click();
      await expect(first.page).toHaveURL(/\/admin$/, { timeout: 15_000 });
      await expect(first.page.getByRole("navigation", { name: "Navigation super-admin" })).toBeVisible({ timeout: 15_000 });
      const [login] = await sql`
        select metadata from platform_admin_audit
        where admin_staff_user_id=${admin.staffId} and action='ADMIN_LOGIN' order by created_at desc limit 1
      `;
      expect(login.metadata).toEqual({ method: "totp" });
    } finally {
      await first.context.close();
    }

    // G. Accès retiré entre le mot de passe et le code : un TOTP valide (pas
    // encore utilisé) ne suffit pas, aucune session.
    const second = await anonymous(browser);
    try {
      await expectAdminLoginOnly(second.page);
      await submitAdminPassword(second.page, admin.email, PASSWORD);
      await expect(second.page.getByLabel("Code de vérification")).toBeVisible({ timeout: 15_000 });
      await sql`delete from platform_admins where staff_user_id=${admin.staffId}`;
      // Anti-rejeu : il faut un pas strictement plus récent que celui de F.
      await expect.poll(() => totpStep(), { timeout: 35_000, intervals: [1_000] }).toBeGreaterThan(enabledStep);
      await second.page.getByLabel("Code de vérification").fill(totpCode(base32Decode(secret)!, enabledStep + 2));
      await second.page.getByRole("button", { name: "Vérifier" }).click();
      await expect(second.page.locator(".notice[role=alert]")).toHaveText(GENERIC_ERROR, { timeout: 15_000 });
      await expect(second.page.getByLabel("Mot de passe")).toBeVisible();
      expect((await second.context.cookies()).find((cookie) => cookie.name === "loyalty_staff")).toBeUndefined();
      await expectAdminLoginOnly(second.page);
    } finally {
      await second.context.close();
    }
  } finally {
    await sql`delete from platform_admins where staff_user_id=${admin.staffId}`;
    await sql.end({ timeout: 5 });
    await admin.context.close();
  }
});

test("admin : limites de débit partagées avec /login, sans blocage du commerçant", async ({ browser }) => {
  const staff = await merchant(browser, "admin-rate");
  const ip = testClientIp();
  const post = (data: Record<string, string>, clientIp = testClientIp()) => staff.page.request.post("/api/auth/login", {
    headers: { origin, "x-real-ip": clientIp },
    data,
  });
  try {
    // Par IP : la page admin consomme le même compteur que /login.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await post({ email: `${unique("ip")}@example.com`, password: PASSWORD, scope: "admin" }, ip)).status()).toBe(401);
    }
    expect((await post({ email: `${unique("ip")}@example.com`, password: PASSWORD }, ip)).status()).toBe(429);

    // Par compte : un non-admin au bon mot de passe compte comme un échec,
    // le blocage s'applique aussi à /login…
    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect((await post({ email: staff.email, password: PASSWORD, scope: "admin" })).status()).toBe(401);
    }
    expect((await post({ email: staff.email, password: PASSWORD, scope: "admin" })).status()).toBe(429);
    expect((await post({ email: staff.email, password: "Wrong-password-123!" })).status()).toBe(429);
    // …mais le titulaire au bon mot de passe entre toujours sur /login.
    expect((await post({ email: staff.email, password: PASSWORD })).status()).toBe(200);
  } finally {
    await staff.context.close();
  }
});

test("admin : formulaire utilisable sur téléphone", async ({ browser }) => {
  const visitor = await anonymous(browser);
  try {
    for (const width of [320, 375, 390, 430]) {
      await visitor.page.setViewportSize({ width, height: 800 });
      await expectAdminLoginOnly(visitor.page);
      const overflow = await visitor.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `@${width}px`).toBeLessThanOrEqual(0);
      const button = await visitor.page.getByRole("button", { name: "Se connecter" }).boundingBox();
      expect(button!.height, `@${width}px`).toBeGreaterThanOrEqual(44);
      expect(button!.x + button!.width, `@${width}px`).toBeLessThanOrEqual(width);
    }
  } finally {
    await visitor.context.close();
  }
});
