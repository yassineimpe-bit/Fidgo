import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { origin, randomizeClientIp, submitSignupAndVerify, testClientIp, unique } from "./helpers";

async function signup(page: Page) {
  const marker = unique("guided");
  await randomizeClientIp(page);
  await page.goto("/signup");
  await page.getByLabel("Nom du commerce").fill(`Commerce ${marker}`);
  await page.getByLabel("Email", { exact: true }).fill(`${marker}@example.com`);
  await page.getByLabel("Mot de passe", { exact: true }).fill("Password-test-123!");
  await submitSignupAndVerify(page, `${marker}@example.com`, "Password-test-123!");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  return marker;
}

async function continueForm(page: Page, next: string) {
  await page.getByRole("button", { name: "Enregistrer et continuer" }).click();
  await expect(page.getByRole("heading", { name: next })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
}

for (const mode of ["STAMPS", "POINTS"] as const) {
  test(`onboarding guidé ${mode} : identité, programme, équipe et QR fonctionnel`, async ({ page, context }) => {
    const marker = await signup(page);
    const name = mode === "POINTS" ? "Boucherie du centre" : "Boulangerie du centre";
    const reward = mode === "POINTS" ? "10 € de remise" : "Un pain offert";
    const threshold = mode === "POINTS" ? "500" : "10";
    const logo = "https://example.com/logo-onboarding.png";
    await context.route(logo, route => route.fulfill({ path: `${process.cwd()}/public/icon-192.png`, contentType: "image/png" }));
    await page.getByLabel("Nom", { exact: true }).fill(name);
    await page.getByLabel("URL du logo").fill(logo);
    await page.getByLabel("Code hexadécimal de la couleur").fill("#7a3e2d");
    await page.getByLabel("Adresse", { exact: true }).fill("12 rue du commerce, 19200 Ussel");
    await page.getByLabel("Téléphone").fill("0555000000");
    const preview = page.getByLabel("Aperçu de la carte fidélité");
    await expect(preview).toContainText(name);
    await expect(preview).toHaveCSS("background-color", "rgb(122, 62, 45)");
    await continueForm(page, "Étape 2 sur 4 · Programme");
    await page.getByLabel("Mode", { exact: true }).selectOption(mode);
    if (mode === "POINTS") {
      await page.getByLabel("Calcul des points").selectOption("PER_EURO");
      await page.getByLabel("Points par euro").fill("1");
    }
    await page.getByLabel("Seuil de récompense").fill(threshold);
    await page.getByLabel("Récompense", { exact: true }).fill(reward);
    await expect(preview).toContainText(`${threshold} ${mode === "POINTS" ? "points" : "tampons"}`);
    await expect(preview).toContainText(reward);
    await continueForm(page, "Étape 3 sur 4 · Équipe");
    const employeeEmail = `${marker}-employee@example.com`;
    if (mode === "POINTS") {
      await page.getByLabel("Email de l’employé").fill(employeeEmail);
      await page.getByLabel("Mot de passe temporaire").fill("Employee-test-123!");
      await page.getByRole("button", { name: "Créer l’accès employé" }).click();
      await expect(page.getByRole("status")).toContainText(employeeEmail);
      // Creation survives refresh without offering to create the employee twice.
      await page.reload();
      await expect(page.getByRole("status")).toContainText(employeeEmail);
      await page.getByRole("button", { name: "Continuer vers mon QR" }).click();
    } else {
      await page.getByRole("button", { name: "Je travaille seul pour le moment" }).click();
    }
    await expect(page.getByRole("heading", { name: "Ton QR d’inscription est prêt" })).toBeVisible();
    await expect(page.getByRole("img", { name: "QR d'inscription" })).toBeVisible();
    const joinUrl = await page.getByRole("link", { name: "Ouvrir l’inscription client" }).getAttribute("href");
    expect(joinUrl).toMatch(new RegExp(`^${origin}/j/`));
    const restaurant = await page.request.get("/api/restaurant").then(r => r.json());
    expect(restaurant).toMatchObject({ name, logo_url: logo, primary_color: "#7a3e2d", phone: "0555000000", address: "12 rue du commerce, 19200 Ussel" });
    const program = await page.request.get("/api/program").then(r => r.json());
    expect(program).toMatchObject({ mode, reward_threshold: Number(threshold), reward_label: reward });
    if (mode === "POINTS") {
      expect(program.points_rule).toBe("PER_EURO");
      expect(Number(program.points_per_euro)).toBe(1);
    }
    await page.getByRole("button", { name: "Terminer et ouvrir mon dashboard" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("link", { name: "Reprendre la configuration" })).toHaveCount(0);
    await page.goto("/onboarding");
    await expect(page).toHaveURL(/\/dashboard$/);
    // A late retry must not rewind the persisted progress.
    expect((await page.request.post("/api/onboarding", { headers: { origin }, data: { action: "finish" } })).ok()).toBeTruthy();
    const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
    try {
      const [saved] = await sql`select onboarding_step from establishments where id=${restaurant.id}`;
      expect(saved.onboarding_step).toBe(5);
      const [audit] = await sql`select count(*)::int n from audit_logs where establishment_id=${restaurant.id} and action='ONBOARDING_ADVANCE' and metadata->>'action'='finish'`;
      expect(audit.n).toBe(1);
    } finally { await sql.end({ timeout: 5 }); }
    const customer = await context.newPage();
    await customer.goto(joinUrl!);
    await customer.getByLabel(/Prénom/).fill("Camille");
    await customer.getByLabel("Email", { exact: true }).fill(`${marker}-client@example.com`);
    await customer.getByRole("button", { name: "Créer ma carte" }).click();
    await expect(customer).toHaveURL(/\/c\//, { timeout: 15000 });
    await expect(customer.locator(".loyalty-card")).toContainText(reward);
    await customer.close();
    if (mode === "POINTS") {
      const employeeContext = await page.context().browser()!.newContext();
      const employeePage = await employeeContext.newPage();
      await employeePage.goto(`${origin}/login`);
      await employeePage.getByLabel("Email").fill(employeeEmail);
      await employeePage.getByLabel("Mot de passe").fill("Employee-test-123!");
      await employeePage.getByRole("button", { name: "Se connecter" }).click();
      await expect(employeePage).toHaveURL(/\/s$/);
      expect((await employeePage.request.post(`${origin}/api/onboarding`, { headers: { origin }, data: { action: "finish" } })).status()).toBe(403);
      await employeePage.goto(`${origin}/onboarding`);
      await expect(employeePage).toHaveURL(/\/s$/);
      await employeeContext.close();
    }
  });
}

test("onboarding : reprise, erreurs réseau, étapes interdites et isolation tenant", async ({ page, browser }) => {
  await signup(page);
  const advance = (action: string, extra = {}) => page.request.post("/api/onboarding", { headers: { origin }, data: { action, ...extra } });
  expect((await advance("finish")).status()).toBe(409);
  expect((await advance("team-skip")).status()).toBe(409);
  expect((await advance("unknown")).status()).toBe(400);
  expect((await page.request.post("/api/onboarding", { headers: { origin: "https://evil.example" }, data: { action: "finish" } })).status()).toBe(403);
  await page.goto("/onboarding?step=4");
  await expect(page.getByRole("heading", { name: "Étape 1 sur 4 · Commerce" })).toBeVisible();
  await page.route("**/api/restaurant", route => route.abort());
  await page.getByRole("button", { name: "Enregistrer et continuer" }).click();
  await expect(page.locator(".notice[role=alert]")).toContainText("Connexion perdue");
  await expect(page.getByRole("button", { name: "Enregistrer et continuer" })).toBeEnabled();
  await page.unroute("**/api/restaurant");
  await page.getByLabel("Code hexadécimal de la couleur").fill("red");
  await expect(page.getByRole("button", { name: "Enregistrer et continuer" })).toBeDisabled();
  await page.getByLabel("Code hexadécimal de la couleur").fill("#123456");
  await continueForm(page, "Étape 2 sur 4 · Programme");
  await page.getByRole("link", { name: "Reprendre plus tard" }).click();
  await page.getByRole("link", { name: "Reprendre la configuration" }).click();
  await expect(page.getByRole("heading", { name: "Étape 2 sur 4 · Programme" })).toBeVisible();
  await page.getByRole("link", { name: "✓ · Commerce" }).click();
  await expect(page.getByLabel("Code hexadécimal de la couleur")).toHaveValue("#123456");
  await continueForm(page, "Étape 2 sur 4 · Programme");
  // Server rejects invalid values and does not advance to the team step.
  expect((await page.request.patch("/api/program", { headers: { origin }, data: null })).status()).toBe(400);
  expect((await page.request.patch("/api/program", { headers: { origin }, data: {
    onboarding: true, mode: "STAMPS", pointsRule: "PER_PURCHASE", rewardThreshold: 0,
    stampsPerVisit: 1, pointsPerPurchase: 1, pointsPerEuro: 1, expiresAfterDays: null,
  } })).status()).toBe(400);
  const original = await page.request.get("/api/program").then(r => r.json());
  await page.route("**/api/program", route => route.fulfill({ status: 400, json: { error: "INVALID_INPUT" } }));
  await page.getByRole("button", { name: "Enregistrer et continuer" }).click();
  await expect(page.locator(".notice[role=alert]")).toBeVisible();
  await page.unroute("**/api/program");
  await page.reload();
  await expect(page.getByLabel("Seuil de récompense")).toHaveValue(String(original.reward_threshold));
  await continueForm(page, "Étape 3 sur 4 · Équipe");
  expect((await advance("team-created")).status()).toBe(409);
  const otherContext = await browser.newContext({ baseURL: origin });
  const other = await otherContext.newPage();
  await signup(other);
  const otherRestaurant = await other.request.get(`${origin}/api/restaurant`).then(r => r.json());
  expect((await advance("team-skip", { establishmentId: otherRestaurant.id })).ok()).toBeTruthy();
  await other.reload();
  await expect(other.getByRole("heading", { name: "Étape 1 sur 4 · Commerce" })).toBeVisible();
  await otherContext.close();
  const finished = await Promise.all([advance("finish"), advance("finish")]);
  for (const response of finished) expect(await response.json()).toMatchObject({ ok: true, step: 5 });
  const restaurant = await page.request.get("/api/restaurant").then(r => r.json());
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const [audit] = await sql`select count(*)::int n from audit_logs where establishment_id=${restaurant.id} and action='ONBOARDING_ADVANCE' and metadata->>'action'='finish'`;
    expect(audit.n).toBe(1);
  } finally { await sql.end({ timeout: 5 }); }
});

test("onboarding : session requise et commerce historique laissé inchangé", async ({ page }) => {
  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/login$/);
  expect((await page.request.post("/api/onboarding", { headers: { origin }, data: { action: "finish" } })).status()).toBe(401);
  await signup(page);
  const restaurant = await page.request.get("/api/restaurant").then(r => r.json());
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try { await sql`update establishments set onboarding_step=null where id=${restaurant.id}`; }
  finally { await sql.end({ timeout: 5 }); }
  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("link", { name: "Reprendre la configuration" })).toHaveCount(0);
});


test("onboarding : MANAGER et VIEWER ne peuvent pas avancer la configuration du propriétaire", async ({ page, browser }) => {
  await signup(page);
  const restaurant = await page.request.get("/api/restaurant").then(r => r.json());
  for (const role of ["MANAGER", "VIEWER"]) {
    const email = `${unique(role.toLowerCase())}@example.com`;
    expect((await page.request.post("/api/employees", { headers: { origin }, data: { email, password: "Password-test-123!", role } })).status()).toBe(201);
    const staffContext = await browser.newContext({ baseURL: origin });
    try {
      expect((await staffContext.request.post("/api/auth/login", { headers: { origin, "x-real-ip": testClientIp() }, data: { email, password: "Password-test-123!" } })).ok()).toBeTruthy();
      expect((await staffContext.request.post("/api/onboarding", { headers: { origin }, data: { action: "team-skip" } })).status()).toBe(403);
      // A manager can edit branding, but cannot validate the owner's guided step.
      const update = await staffContext.request.patch("/api/restaurant", { headers: { origin }, data: { name: restaurant.name, onboarding: true } });
      expect(update.status()).toBe(role === "MANAGER" ? 200 : 403);
      const staffPage = await staffContext.newPage();
      await staffPage.goto("/onboarding");
      await expect(staffPage).toHaveURL(/\/dashboard$/);
    } finally { await staffContext.close(); }
  }
  await page.reload();
  await expect(page.getByRole("heading", { name: "Étape 1 sur 4 · Commerce" })).toBeVisible();
});
