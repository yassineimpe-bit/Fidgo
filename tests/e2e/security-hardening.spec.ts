import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { createMerchant, currentCustomerId, enrollCustomer, origin, testClientIp, unique } from "./helpers";

/**
 * Regressions du durcissement de securite. Chaque test correspond a une faille
 * identifiee en audit : si l'un d'eux repasse au rouge, la faille est revenue.
 */

test("login : 20 echecs d'un tiers ne verrouillent pas le titulaire du compte", async ({ page }) => {
  const marker = unique("lockout");
  const email = `${marker}@example.com`;
  const password = "Password-test-123!";

  await page.setExtraHTTPHeaders({ "x-real-ip": testClientIp() });
  await page.goto("/signup");
  await page.getByLabel("Nom du commerce").fill(`Commerce ${marker}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Créer mon espace" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // L'attaquant change d'IP a chaque coup : le plafond par IP (10/15 min) ne
  // le freine pas, seul le compteur par compte entre en jeu.
  let throttled = 0;
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const response = await page.request.post("/api/auth/login", {
      headers: { origin, "x-real-ip": testClientIp() },
      data: { email, password: `wrong-${attempt}` },
    });
    expect([401, 429]).toContain(response.status());
    if (response.status() === 429) throttled += 1;
  }

  // Les echecs finissent bien par etre throttles : le garde-fou anti
  // brute-force distribue reste actif.
  expect(throttled).toBeGreaterThan(0);

  // Mais le titulaire passe toujours avec le bon mot de passe. Avant le
  // correctif, cette requete renvoyait 429 : 20 requetes d'un inconnu
  // suffisaient a bloquer une caisse pendant 15 minutes.
  const legitimate = await page.request.post("/api/auth/login", {
    headers: { origin, "x-real-ip": testClientIp() },
    data: { email, password },
  });
  expect(legitimate.status()).toBe(200);

  // Et le succes a remis le compteur a zero : l'echec suivant repart de 401.
  const afterReset = await page.request.post("/api/auth/login", {
    headers: { origin, "x-real-ip": testClientIp() },
    data: { email, password: "wrong-again" },
  });
  expect(afterReset.status()).toBe(401);
});

test("export RGPD : plafonne et trace dans audit_logs", async ({ page }) => {
  await createMerchant(page, "export-audit");
  const { shortCode } = await enrollCustomer(page, "Claire", `${unique("export")}@example.com`);
  expect(shortCode).toMatch(/^[A-Z0-9]{6}$/);

  const customerId = await currentCustomerId(page);
  const exported = await page.request.get(`/api/customers/${customerId}/export`);
  expect(exported.ok()).toBeTruthy();

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    // Sans cette trace, une exfiltration par un compte legitime ne laissait
    // aucune trace exploitable en reponse a incident.
    const [audit] = await sql`
      select action, staff_user_id from audit_logs
      where entity_type = 'customer' and entity_id = ${customerId} and action = 'CUSTOMER_EXPORT'
      limit 1
    `;
    expect(audit).toBeTruthy();
    expect(audit.staff_user_id).toBeTruthy();
  } finally {
    await sql.end({ timeout: 5 });
  }
});

test("routes publiques : les gardes ajoutees repondent bien", async ({ page }) => {
  // /api/cron/purge : ferme par defaut, meme sans CRON_SECRET configure.
  const cronAnonymous = await page.request.get("/api/cron/purge");
  expect(cronAnonymous.status()).toBe(401);

  const cronWrongSecret = await page.request.get("/api/cron/purge", {
    headers: { authorization: "Bearer mauvais-secret-de-la-bonne-taille" },
  });
  expect(cronWrongSecret.status()).toBe(401);

  // /api/card/status : etait la seule route POST sans controle d'origine.
  const crossOrigin = await page.request.post("/api/card/status", {
    headers: { origin: "https://exemple-tiers.test" },
    data: { token: "LOY1:aaaaaaaaaaaaaaaaaaaaaa" },
  });
  expect(crossOrigin.status()).toBe(403);

  // /api/transactions/reverse : un id non-UUID renvoyait 500 (erreur Postgres
  // 22P02 remontee brute) au lieu d'un 400.
  await createMerchant(page, "reverse-input");
  const badId = await page.request.post("/api/transactions/reverse", {
    headers: { origin },
    data: { transactionId: "pas-un-uuid", idempotencyKey: unique("idem") },
  });
  expect(badId.status()).toBe(400);
});

test("enroll : un slug inconnu ne cree pas de compteur de rate-limit", async ({ page }) => {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const [before] = await sql`select count(*)::int as total from rate_limits`;

    // Chaque slug inedit ouvrait auparavant un bucket neuf : ecriture illimitee
    // en base par un anonyme, et aucun frein reel sur l'enumeration.
    const ip = testClientIp();
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await page.request.post("/api/enroll", {
        headers: { origin, "x-real-ip": ip },
        data: { slug: unique("slug-inexistant"), email: `${unique("ghost")}@example.com` },
      });
      expect(response.status()).toBe(404);
    }

    const [after] = await sql`select count(*)::int as total from rate_limits`;
    // Un seul compteur cree : celui par IP, dont l'espace de cles est borne.
    expect(Number(after.total) - Number(before.total)).toBeLessThanOrEqual(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
});


test("XSS stocké : le branding reste du texte inerte et la CSP bloque l'exécution inline", async ({ page }) => {
  await createMerchant(page, "xss-stored");
  const payload = `<img src=x onerror="window.__retikoXss=1">`;

  const updated = await page.request.patch("/api/restaurant", {
    headers: { origin },
    data: { name: payload },
  });
  expect(updated.ok()).toBeTruthy();

  await page.goto("/dashboard");
  await expect(page.getByText(payload, { exact: true })).toBeVisible();
  expect(await page.locator('img[src="x"]').count()).toBe(0);
  expect(await page.evaluate(() => (window as Window & { __retikoXss?: number }).__retikoXss)).toBeUndefined();

  const response = await page.request.get("/dashboard");
  const csp = response.headers()["content-security-policy"] || "";
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("'strict-dynamic'");
  expect(csp).toMatch(/script-src 'self' 'nonce-[^']+'/);
  const scriptDirective = csp.split(";").find((directive) => directive.trim().startsWith("script-src")) || "";
  expect(scriptDirective).not.toContain("'unsafe-inline'");
});

test("session fixation : le login remplace un cookie attaquant par une nouvelle session signée", async ({ page }) => {
  const marker = unique("session-fixation");
  const email = `${marker}@example.com`;
  const password = "Password-test-123!";

  await page.setExtraHTTPHeaders({ "x-real-ip": testClientIp() });
  await page.goto("/signup");
  await page.getByLabel("Nom du commerce").fill(`Commerce ${marker}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Créer mon espace" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.request.post("/api/auth/logout", { headers: { origin } });

  const attackerCookie = "attacker-controlled-session";
  await page.context().addCookies([{
    name: "loyalty_staff",
    value: attackerCookie,
    url: origin,
    httpOnly: false,
    sameSite: "Lax",
  }]);

  const before = await page.context().cookies(origin);
  expect(before.find((cookie) => cookie.name === "loyalty_staff")?.value).toBe(attackerCookie);

  const login = await page.request.post("/api/auth/login", {
    headers: { origin, "x-real-ip": testClientIp() },
    data: { email, password },
  });
  expect(login.status()).toBe(200);

  const after = await page.context().cookies(origin);
  const session = after.find((cookie) => cookie.name === "loyalty_staff");
  expect(session).toBeTruthy();
  expect(session?.value).not.toBe(attackerCookie);
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe("Lax");

  const dashboard = await page.request.get("/api/dashboard");
  expect(dashboard.status()).toBe(200);
});

test("client bundle : aucun secret serveur connu n'est exposé au navigateur", async ({ page }) => {
  const knownSecrets = [
    process.env.AUTH_SECRET || "fidgo-playwright-secret-at-least-32-characters",
    "sk_test_e2e_placeholder",
    "whsec_retiko_e2e",
    process.env.DATABASE_URL || "",
  ].filter((value) => value.length >= 12);

  const login = await page.request.get("/login");
  expect(login.ok()).toBeTruthy();
  const html = await login.text();

  const chunkPaths = Array.from(new Set(
    html.match(/\/_next\/static\/[^"'\s]+\.js/g) || [],
  ));

  const payloads = [html];
  for (const chunkPath of chunkPaths) {
    const response = await page.request.get(chunkPath);
    if (response.ok()) payloads.push(await response.text());
  }

  const browserPayload = payloads.join("\n");
  for (const secret of knownSecrets) {
    expect(browserPayload.includes(secret)).toBe(false);
  }

  expect(browserPayload).not.toContain("STRIPE_SECRET_KEY");
  expect(browserPayload).not.toContain("STRIPE_WEBHOOK_SECRET");
  expect(browserPayload).not.toContain("DATABASE_URL");
  expect(browserPayload).not.toContain("AUTH_SECRET");
});
