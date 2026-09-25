import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import postgres from "postgres";
import { base32Decode, totpCode, totpStep } from "../../lib/totp";
import { origin, randomizeClientIp, submitSignupAndVerify, testClientIp, unique } from "./helpers";

const password = "Password-test-123!";

function code(secret: string, step: number) {
  return totpCode(base32Decode(secret)!, step);
}

/** Nouveau navigateur, IP logique propre : mot de passe saisi, seconde étape affichée. */
async function passwordStep(browser: Browser, email: string) {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": testClientIp() } });
  const page = await context.newPage();
  await page.goto(`${origin}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByLabel("Code de vérification")).toBeVisible({ timeout: 15_000 });
  return { context, page };
}

async function cookieValue(context: BrowserContext, name: string) {
  return (await context.cookies()).find((cookie) => cookie.name === name)?.value;
}

test("2FA TOTP : activation, connexion en deux étapes, rejeu refusé, codes de secours, désactivation", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const marker = unique("two-factor");
  const email = `${marker}@example.com`;
  await randomizeClientIp(page);
  await page.goto("/signup");
  await page.getByLabel("Nom du commerce").fill(`Commerce ${marker}`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await submitSignupAndVerify(page, email, password);

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  const opened: BrowserContext[] = [];
  try {
    // Activation : mot de passe redemandé, QR + clé, premier code, codes de secours.
    await page.goto("/dashboard/security");
    await page.getByRole("button", { name: "Activer la double authentification" }).click();
    await page.locator("#two-factor-password").fill("wrong-password");
    await page.getByRole("button", { name: "Continuer" }).click();
    await expect(page.getByText("Mot de passe incorrect.")).toBeVisible();
    await page.locator("#two-factor-password").fill(password);
    await page.getByRole("button", { name: "Continuer" }).click();
    await expect(page.getByRole("img", { name: "QR code de la double authentification" })).toBeVisible();
    const secret = (await page.getByTestId("two-factor-secret").textContent())!.trim();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    const enabledStep = totpStep();
    await page.getByLabel("2. Code à 6 chiffres affiché par l’application").fill(code(secret, enabledStep));
    await page.getByRole("button", { name: "Activer la double authentification" }).click();
    const recoveryList = page.getByRole("list", { name: "Codes de secours" }).getByRole("listitem");
    await expect(recoveryList).toHaveCount(10);
    const recoveryCodes = (await recoveryList.allTextContents()).map((value) => value.trim());
    await page.getByRole("button", { name: "J’ai enregistré mes codes" }).click();
    await expect(page.getByText("Codes de secours restants : 10")).toBeVisible();
    // La session courante reste valide malgré la révocation des autres appareils.
    expect((await page.request.get("/api/restaurant")).status()).toBe(200);

    const [staff] = await sql`select id, establishment_id from staff_users where lower(email)=${email}`;
    const [stored] = await sql`select secret_encrypted, enabled_at from staff_two_factor where staff_user_id=${staff.id}`;
    expect(stored.enabled_at).not.toBeNull();
    expect(String(stored.secret_encrypted)).not.toContain(secret);
    const hashes = await sql`select code_hash from staff_two_factor_recovery_codes where staff_user_id=${staff.id}`;
    expect(hashes).toHaveLength(10);
    expect(hashes.map((row) => row.code_hash)).not.toContain(recoveryCodes[0]);
    const [enabledAudit] = await sql`select count(*)::int as n from audit_logs where staff_user_id=${staff.id} and action='STAFF_TWO_FACTOR_ENABLED'`;
    expect(enabledAudit.n).toBe(1);

    // Mot de passe seul : aucune session. Le jeton d'attente ne vaut pas session.
    const first = await passwordStep(browser, email);
    opened.push(first.context);
    expect((await first.page.request.get(`${origin}/api/restaurant`)).status()).toBe(401);
    const pendingToken = await cookieValue(first.context, "loyalty_mfa");
    expect(pendingToken).toBeTruthy();
    const forged = await browser.newContext();
    opened.push(forged);
    await forged.addCookies([{ name: "loyalty_staff", value: pendingToken!, url: origin }]);
    expect((await forged.request.get(`${origin}/api/restaurant`)).status()).toBe(401);

    // Mauvais code refusé, bon code accepté.
    const current = totpStep();
    const valid = new Set([current - 1, current, current + 1].map((step) => code(secret, step)));
    const wrong = ["000000", "111111", "222222"].find((candidate) => !valid.has(candidate))!;
    await first.page.getByLabel("Code de vérification").fill(wrong);
    await first.page.getByRole("button", { name: "Vérifier" }).click();
    await expect(first.page.getByText(/Code incorrect ou déjà utilisé/)).toBeVisible();
    const loginCode = code(secret, enabledStep + 1);
    await first.page.getByLabel("Code de vérification").fill(loginCode);
    await first.page.getByRole("button", { name: "Vérifier" }).click();
    await expect(first.page).toHaveURL(/\/(onboarding|dashboard)$/, { timeout: 15_000 });
    expect((await first.page.request.get(`${origin}/api/restaurant`)).status()).toBe(200);
    expect(await cookieValue(first.context, "loyalty_mfa")).toBeFalsy();

    // Le même code ne sert pas deux fois ; un code de secours, une seule fois.
    const second = await passwordStep(browser, email);
    opened.push(second.context);
    await second.page.getByLabel("Code de vérification").fill(loginCode);
    await second.page.getByRole("button", { name: "Vérifier" }).click();
    await expect(second.page.getByText(/Code incorrect ou déjà utilisé/)).toBeVisible();
    await second.page.getByRole("button", { name: "Utiliser un code de secours" }).click();
    await second.page.getByLabel("Code de secours").fill(recoveryCodes[0].toLowerCase());
    await second.page.getByRole("button", { name: "Vérifier" }).click();
    await expect(second.page).toHaveURL(/\/(onboarding|dashboard)$/, { timeout: 15_000 });

    const third = await passwordStep(browser, email);
    opened.push(third.context);
    await third.page.getByRole("button", { name: "Utiliser un code de secours" }).click();
    await third.page.getByLabel("Code de secours").fill(recoveryCodes[0]);
    await third.page.getByRole("button", { name: "Vérifier" }).click();
    await expect(third.page.getByText(/Code incorrect ou déjà utilisé/)).toBeVisible();

    // Acharnement sur la seconde étape : limité par compte.
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 7; attempt += 1) {
      const response = await third.page.request.post(`${origin}/api/auth/login/verify`, { headers: { origin }, data: { code: wrong } });
      statuses.push(response.status());
    }
    expect(statuses).toContain(429);
    expect(statuses.every((status) => status === 401 || status === 429)).toBe(true);

    const methods = await sql`
      select metadata->>'method' as method from audit_logs
      where staff_user_id=${staff.id} and action='LOGIN_TWO_FACTOR_VERIFIED' order by created_at
    `;
    expect(methods.map((row) => row.method)).toEqual(["totp", "recovery_code"]);

    // Désactivation : mot de passe + second facteur.
    await page.goto("/dashboard/security");
    await expect(page.getByText("Codes de secours restants : 9")).toBeVisible();
    await page.getByRole("button", { name: "Désactiver" }).click();
    await page.locator("#two-factor-disable-password").fill(password);
    await page.getByLabel("Code de l’application ou code de secours").fill(recoveryCodes[1]);
    await page.getByRole("button", { name: "Désactiver" }).click();
    await expect(page.getByText("Double authentification désactivée.")).toBeVisible();
    expect(await sql`select 1 from staff_two_factor where staff_user_id=${staff.id}`).toHaveLength(0);
    expect(await sql`select 1 from staff_two_factor_recovery_codes where staff_user_id=${staff.id}`).toHaveLength(0);

    // Connexion de nouveau en un facteur.
    const plain = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": testClientIp() } });
    opened.push(plain);
    const login = await plain.request.post(`${origin}/api/auth/login`, { headers: { origin }, data: { email, password } });
    expect(login.status()).toBe(200);
    expect(await login.json()).toMatchObject({ ok: true });
  } finally {
    for (const context of opened) await context.close();
    await sql.end({ timeout: 5 });
  }
});

test("2FA : jeton d'attente invalidé par un changement de mot de passe, API protégée", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const marker = unique("two-factor-api");
  const email = `${marker}@example.com`;
  await randomizeClientIp(page);
  await page.goto("/signup");
  await page.getByLabel("Nom du commerce").fill(`Commerce ${marker}`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await submitSignupAndVerify(page, email, password);

  // Sans session : rien n'est accessible ; autre origine refusée.
  const anonymous = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": testClientIp() } });
  expect((await anonymous.request.post(`${origin}/api/account/two-factor`, { headers: { origin }, data: { action: "setup", password } })).status()).toBe(401);
  expect((await anonymous.request.post(`${origin}/api/auth/login/verify`, { headers: { origin }, data: { code: "123456" } })).status()).toBe(401);
  await anonymous.close();
  expect((await page.request.post("/api/account/two-factor", { headers: { origin: "https://evil.example" }, data: { action: "setup", password } })).status()).toBe(403);

  const setup = await page.request.post("/api/account/two-factor", { headers: { origin }, data: { action: "setup", password } });
  expect(setup.status()).toBe(200);
  const { secret } = await setup.json();
  // Tant que le premier code n'est pas confirmé, la connexion reste en un facteur.
  const beforeConfirm = await page.request.get("/api/account/two-factor");
  expect(await beforeConfirm.json()).toMatchObject({ available: true, enabled: false });
  const enabled = await page.request.post("/api/account/two-factor", { headers: { origin }, data: { action: "enable", code: code(secret, totpStep()) } });
  expect(enabled.status()).toBe(200);
  expect((await enabled.json()).recoveryCodes).toHaveLength(10);
  expect((await page.request.post("/api/account/two-factor", { headers: { origin }, data: { action: "setup", password } })).status()).toBe(409);

  const pending = await passwordStep(browser, email);
  try {
    // Le mot de passe change entre les deux étapes : le jeton d'attente ne vaut plus rien.
    const changed = await page.request.post("/api/auth/change-password", {
      headers: { origin },
      data: { currentPassword: password, newPassword: "Password-test-456!", confirmPassword: "Password-test-456!" },
    });
    expect(changed.ok()).toBeTruthy();
    const late = await pending.page.request.post(`${origin}/api/auth/login/verify`, { headers: { origin }, data: { code: code(secret, totpStep() + 1) } });
    expect(late.status()).toBe(401);
    expect(await late.json()).toEqual({ error: "TWO_FACTOR_EXPIRED" });
  } finally {
    await pending.context.close();
  }
});
