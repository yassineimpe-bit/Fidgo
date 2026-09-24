import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import postgres from "postgres";
import { chromium } from "playwright";

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
const outDir = path.join(process.cwd(), "docs", "ui-review-jpegs");
await fs.mkdir(outDir, { recursive: true });

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
const browser = await chromium.launch({ headless: true });

const OWNER_EMAIL = "ui-capture-owner@example.test";
const OWNER_PASSWORD = "Password-test-123!";
const TARGET_EMAIL = "ui-capture-target@example.test";
const TARGET_PASSWORD = OWNER_PASSWORD;
const rows = [];

function nameFor(route, prefix = "desktop") {
  if (route === "/") return `${prefix}-home.jpg`;
  return `${prefix}-${route.replace(/^\//, "").replace(/\?.*$/, "").replace(/\[|\]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "") || "home"}.jpg`;
}

async function shot(page, route, filename, { fullPage = true, note = "" } = {}) {
  await page.goto(baseURL + route, { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(outDir, filename), type: "jpeg", quality: 90, fullPage });
  rows.push({ file: filename, route, viewport: `${page.viewportSize()?.width}x${page.viewportSize()?.height}`, note });
}

async function signup(page, commerceName, email, password) {
  await page.goto(baseURL + "/signup", { waitUntil: "networkidle" });
  await page.getByLabel("Nom du commerce").fill(commerceName);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Créer mon espace" }).click();
  await page.waitForURL("**/onboarding");
  const restaurant = await page.request.get(baseURL + "/api/restaurant").then(r => r.json());
  return restaurant;
}

async function mobileContext(storageState) {
  return browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    storageState,
  });
}

try {
  const publicDesktop = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const pub = await publicDesktop.newPage();
  for (const [route, file, note] of [
    ["/", "desktop-home.jpg", "Landing"],
    ["/login", "desktop-login.jpg", "Connexion"],
    ["/signup", "desktop-signup.jpg", "Création commerce"],
    ["/forgot-password", "desktop-forgot-password.jpg", "Mot de passe oublié"],
    ["/reset-password?token=" + "A".repeat(43), "desktop-reset-password.jpg", "Formulaire de réinitialisation, token de forme valide mais fictif"],
    ["/recover/" + "A".repeat(43), "desktop-recover-card.jpg", "Récupération de carte, token de forme valide mais fictif"],
    ["/offline", "desktop-offline.jpg", "Écran hors ligne"],
  ]) await shot(pub, route, file, { note });

  const publicMobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const pm = await publicMobile.newPage();
  for (const [route, file, note] of [
    ["/", "mobile-home.jpg", "Landing mobile"],
    ["/login", "mobile-login.jpg", "Connexion mobile"],
    ["/signup", "mobile-signup.jpg", "Création commerce mobile"],
    ["/forgot-password", "mobile-forgot-password.jpg", "Mot de passe oublié mobile"],
    ["/offline", "mobile-offline.jpg", "Hors ligne mobile"],
  ]) await shot(pm, route, file, { note });
  await publicMobile.close();
  await publicDesktop.close();

  const ownerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const owner = await ownerContext.newPage();
  const ownerRestaurant = await signup(owner, "Atelier Retiko Démo", OWNER_EMAIL, OWNER_PASSWORD);
  const establishmentId = String(ownerRestaurant.id);
  const slug = String(ownerRestaurant.slug);

  await shot(owner, "/onboarding", "desktop-onboarding-step-1.jpg", { note: "Onboarding étape 1" });
  await sql`update establishments set onboarding_step=2 where id=${establishmentId}`;
  await shot(owner, "/onboarding?step=2", "desktop-onboarding-step-2.jpg", { note: "Onboarding étape 2" });
  await sql`update establishments set onboarding_step=3 where id=${establishmentId}`;
  await shot(owner, "/onboarding?step=3", "desktop-onboarding-step-3.jpg", { note: "Onboarding étape 3" });
  await sql`update establishments set onboarding_step=4 where id=${establishmentId}`;
  await shot(owner, "/onboarding?step=4", "desktop-onboarding-step-4.jpg", { note: "Onboarding étape 4" });
  await sql`update establishments set onboarding_step=5 where id=${establishmentId}`;

  const ownerState = await ownerContext.storageState();
  const ownerMobile = await mobileContext(ownerState);
  const om = await ownerMobile.newPage();
  await shot(om, "/dashboard", "mobile-dashboard.jpg", { note: "Dashboard commerçant mobile" });
  await shot(om, "/onboarding?step=4", "mobile-onboarding.jpg", { note: "La route redirige au dashboard une fois l'onboarding terminé" });
  await ownerMobile.close();

  const customerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const customer = await customerContext.newPage();
  await shot(customer, `/j/${slug}`, "desktop-client-join.jpg", { note: "Inscription client" });
  await customer.getByLabel(/Prénom/).fill("Camille");
  await customer.getByLabel(/Email/).fill("camille.demo@example.test");
  await customer.getByRole("button", { name: "Créer ma carte" }).click();
  await customer.waitForURL("**/c/**");
  const cardUrl = new URL(customer.url());
  const cardPath = cardUrl.pathname;
  const cardToken = cardPath.split("/").at(-1);
  await customer.screenshot({ path: path.join(outDir, "desktop-client-card.jpg"), type: "jpeg", quality: 90, fullPage: true });
  rows.push({ file: "desktop-client-card.jpg", route: cardPath, viewport: "1440x1000", note: "Carte fidélité client" });

  const customerMobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const cm = await customerMobile.newPage();
  await shot(cm, `/j/${slug}`, "mobile-client-join.jpg", { note: "Inscription client mobile" });
  await shot(cm, cardPath, "mobile-client-card.jpg", { note: "Carte fidélité mobile" });
  await customerMobile.close();

  await owner.request.post(baseURL + "/api/credit", {
    headers: { origin: baseURL },
    data: { token: `LOY1:${cardToken}`, idempotencyKey: crypto.randomUUID() },
  }).catch(() => null);

  const [customerRow] = await sql`select id from customers where establishment_id=${establishmentId} and deleted_at is null order by created_at desc limit 1`;
  const customerId = customerRow ? String(customerRow.id) : "";

  const dashboardRoutes = [
    ["/dashboard", "desktop-dashboard.jpg", "Vue d'ensemble commerçant"],
    ["/dashboard/activity", "desktop-dashboard-activity.jpg", "Activité"],
    ["/dashboard/analytics", "desktop-dashboard-analytics.jpg", "Analytics"],
    ["/dashboard/billing", "desktop-dashboard-billing.jpg", "Facturation"],
    ["/dashboard/clients", "desktop-dashboard-clients.jpg", "Liste clients"],
    ...(customerId ? [[`/dashboard/clients/${customerId}`, "desktop-dashboard-client-detail.jpg", "Fiche client"]] : []),
    ["/dashboard/employees", "desktop-dashboard-employees.jpg", "Employés"],
    ["/dashboard/poster", "desktop-dashboard-poster.jpg", "Affiche QR"],
    ["/dashboard/program", "desktop-dashboard-program.jpg", "Programme fidélité"],
    ["/dashboard/security", "desktop-dashboard-security.jpg", "Sécurité"],
    ["/dashboard/settings", "desktop-dashboard-settings.jpg", "Commerce / branding"],
    ["/dashboard/transactions", "desktop-dashboard-transactions.jpg", "Transactions"],
    ["/dashboard/wallet", "desktop-dashboard-wallet.jpg", "Wallet"],
  ];
  for (const [route, file, note] of dashboardRoutes) await shot(owner, route, file, { note });

  await shot(owner, "/s", "desktop-scanner.jpg", { fullPage: false, note: "Scanner, viewport plein écran" });
  await shot(owner, "/s/stats", "desktop-scanner-stats.jpg", { note: "Statistiques scanner" });

  const scannerMobile = await mobileContext(ownerState);
  const sm = await scannerMobile.newPage();
  await shot(sm, "/s", "mobile-scanner.jpg", { fullPage: false, note: "Scanner mobile, viewport plein écran" });
  await shot(sm, "/s/stats", "mobile-scanner-stats.jpg", { note: "Stats scanner mobile" });
  await scannerMobile.close();

  const targetContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const target = await targetContext.newPage();
  const targetRestaurant = await signup(target, "Boulangerie Démo", TARGET_EMAIL, TARGET_PASSWORD);
  const targetEstablishmentId = String(targetRestaurant.id);
  await sql`update establishments set onboarding_step=5 where id=${targetEstablishmentId}`;

  const [ownerStaff] = await sql`select id from staff_users where lower(email)=${OWNER_EMAIL} limit 1`;
  if (ownerStaff) {
    await sql`insert into platform_admins(staff_user_id, note) values(${ownerStaff.id}, 'capture UI temporaire') on conflict (staff_user_id) do update set note=excluded.note`;
    const adminRoutes = [
      ["/admin", "desktop-admin-overview.jpg", "Super-admin vue d'ensemble"],
      ["/admin/establishments", "desktop-admin-establishments.jpg", "Super-admin commerces"],
      [`/admin/establishments/${targetEstablishmentId}`, "desktop-admin-establishment-detail.jpg", "Super-admin fiche commerce"],
      ["/admin/users", "desktop-admin-users.jpg", "Super-admin utilisateurs"],
      ["/admin/subscriptions", "desktop-admin-subscriptions.jpg", "Super-admin abonnements"],
      ["/admin/audit", "desktop-admin-audit.jpg", "Super-admin journal"],
    ];
    for (const [route, file, note] of adminRoutes) await shot(owner, route, file, { note });

    const adminMobile = await mobileContext(ownerState);
    const am = await adminMobile.newPage();
    await shot(am, "/admin", "mobile-admin-overview.jpg", { note: "Super-admin mobile" });
    await adminMobile.close();
  }

  await targetContext.close();
  await customerContext.close();
  await ownerContext.close();

  rows.sort((a, b) => a.file.localeCompare(b.file));
  const md = [
    "# Retiko — captures UI actuelles",
    "",
    "Captures générées automatiquement depuis la branche de référence, sur base PostgreSQL de test uniquement.",
    "",
    "| Fichier | Route | Viewport | Note |",
    "|---|---|---:|---|",
    ...rows.map(r => `| ${r.file} | \`${r.route}\` | ${r.viewport} | ${r.note || ""} |`),
    "",
  ].join("\n");
  await fs.writeFile(path.join(outDir, "INDEX.md"), md, "utf8");
  console.log(`Generated ${rows.length} JPEG screenshots in ${outDir}`);
} finally {
  await browser.close().catch(() => {});
  await sql.end({ timeout: 5 }).catch(() => {});
}
