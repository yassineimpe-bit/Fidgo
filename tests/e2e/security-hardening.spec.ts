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
