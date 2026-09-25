import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { LEGAL_VERSION } from "../../lib/legal";
import { legalAcceptance, origin, testClientIp, unique } from "./helpers";

const PAGES = [
  ["/legal/cgu", "Conditions générales d’utilisation"],
  ["/legal/cgv", "Conditions générales de vente"],
  ["/legal/mentions-legales", "Mentions légales"],
  ["/legal/confidentialite", "Politique de confidentialité"],
  ["/legal/cookies", "Cookies et traceurs"],
] as const;

test("pages légales : publiques, reliées entre elles et sans identité inventée", async ({ page }) => {
  for (const [path, title] of PAGES) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(title);
    // Jamais présenté comme validé : l'avertissement figure sur chaque document.
    await expect(page.getByText("n’a pas encore été validé juridiquement")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Informations légales" }).getByRole("link")).toHaveCount(5);
  }

  await page.goto("/legal/mentions-legales");
  await expect(page.getByText("[À COMPLÉTER]").first()).toBeVisible();
  expect(await page.locator("body").innerText()).not.toMatch(/\b\d{9}\b|\bRCS [A-Z]/);

  // Prix et durée d'essai lus depuis le code de facturation, pas recopiés.
  await page.goto("/legal/cgv");
  await expect(page.getByText("24,99 € HT/mois")).toBeVisible();
  await expect(page.getByText("40 € pour frais de recouvrement")).toBeVisible();
});

test("liens légaux présents sur l'accueil, l'inscription, la connexion et la carte client", async ({ page }) => {
  for (const path of ["/", "/signup", "/login"]) {
    await page.goto(path);
    const nav = page.getByRole("navigation", { name: "Informations légales" });
    await expect(nav.getByRole("link", { name: "Confidentialité" }), path).toBeVisible();
    await expect(nav.getByRole("link", { name: "CGV" }), path).toBeVisible();
  }
  await page.goto("/");
  await page.getByRole("navigation", { name: "Informations légales" }).getByRole("link", { name: "Cookies" }).click();
  await expect(page).toHaveURL(/\/legal\/cookies$/);
});

test("signup : acceptation CGU/CGV obligatoire côté serveur, marketing séparé et prouvé", async ({ page }) => {
  // Une IP logique par appel : le quota signup (5/h) ne doit pas être le sujet du test.
  const headers = () => ({ origin, "x-real-ip": testClientIp() });
  const base = { restaurantName: "Commerce légal", password: "Password-test-123!" };

  const missing = await page.request.post("/api/auth/signup", { headers: headers(), data: { ...base, email: `${unique("legal-missing")}@example.com` } });
  expect(missing.status()).toBe(400);
  expect((await missing.json()).error).toBe("LEGAL_ACCEPTANCE_REQUIRED");

  const stale = await page.request.post("/api/auth/signup", {
    headers: headers(),
    data: { ...base, email: `${unique("legal-stale")}@example.com`, legalAccepted: true, legalVersion: "2020-01-01" },
  });
  expect(stale.status()).toBe(400);
  expect((await stale.json()).error).toBe("LEGAL_ACCEPTANCE_REQUIRED");

  const withoutMarketing = `${unique("legal-no-mkt")}@example.com`;
  const withMarketing = `${unique("legal-mkt")}@example.com`;
  expect((await page.request.post("/api/auth/signup", { headers: headers(), data: { ...base, ...legalAcceptance, email: withoutMarketing } })).status()).toBe(202);
  expect((await page.request.post("/api/auth/signup", { headers: headers(), data: { ...base, ...legalAcceptance, email: withMarketing, marketingOptIn: true } })).status()).toBe(202);

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const proof = await sql`
      select s.email, s.marketing_consent, s.marketing_consent_at, a.document_type, a.document_version, a.source, a.establishment_id = s.establishment_id as same_tenant
      from staff_users s join legal_acceptances a on a.staff_user_id = s.id
      where s.email in (${withoutMarketing}, ${withMarketing})
      order by s.email, a.document_type
    `;
    expect(proof).toHaveLength(4);
    for (const row of proof) {
      expect(row.document_version).toBe(LEGAL_VERSION);
      expect(row.source).toBe("signup");
      expect(row.same_tenant).toBe(true);
      expect(row.marketing_consent).toBe(row.email === withMarketing);
      expect(Boolean(row.marketing_consent_at)).toBe(row.email === withMarketing);
    }
    expect(proof.map((row) => row.document_type).sort()).toEqual(["CGU", "CGU", "CGV", "CGV"]);

    // Réinscription sur une adresse non vérifiée (#127) : nouvelle preuve, dernier choix marketing.
    expect((await page.request.post("/api/auth/signup", { headers: headers(), data: { ...base, ...legalAcceptance, email: withMarketing } })).status()).toBe(202);
    const [after] = await sql`
      select s.marketing_consent, s.marketing_consent_at, count(a.id)::int as acceptances
      from staff_users s join legal_acceptances a on a.staff_user_id = s.id
      where s.email = ${withMarketing} group by s.id
    `;
    expect(after).toMatchObject({ marketing_consent: false, marketing_consent_at: null, acceptances: 4 });
  } finally {
    await sql.end({ timeout: 5 });
  }
});

test("signup UI : la case contractuelle bloque l'envoi, la case marketing n'est jamais pré-cochée", async ({ page }) => {
  await page.goto("/signup");
  await expect(page.getByRole("checkbox", { name: /J’accepte les CGU/ })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: /nouveautés et offres de Retiko/ })).not.toBeChecked();

  let submitted = false;
  page.on("request", (request) => { if (request.url().endsWith("/api/auth/signup")) submitted = true; });
  await page.getByLabel("Nom du commerce").fill("Commerce sans accord");
  await page.getByLabel("Email").fill(`${unique("legal-ui")}@example.com`);
  await page.getByLabel("Mot de passe").fill("Password-test-123!");
  await page.getByRole("button", { name: "Créer mon espace" }).click();
  await expect(page).toHaveURL(/\/signup$/);
  expect(submitted).toBe(false);
});
