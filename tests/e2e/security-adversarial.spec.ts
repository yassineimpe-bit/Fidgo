import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import postgres from "postgres";
import { origin, testClientIp, unique } from "./helpers";

test.setTimeout(180_000);

const PASSWORD = "Password-test-123!";
const COOKIE = "loyalty_staff";

// Chaque payload vise un chemin différent : balise, sortie d'attribut, SVG,
// sortie d'un <script> (données RSC), javascript:, balise non fermée,
// séparateurs de ligne JS dans du JSON inline.
const P = {
  script: "<script>window.__xss=1</script>",
  attr: "\"><img src=x onerror=window.__xss=2>",
  svg: "<svg/onload=window.__xss=3>",
  scriptBreak: "</script><script>window.__xss=4</script>",
  jsLink: "<a href=\"javascript:window.__xss=5\">x</a>",
  broken: "<img src=x onerror=window.__xss=6 ",
  unicode: "\u202Etxt.exe\u200B\u2028\u2029<b>",
};
const RAW_MARKERS = ["<script>window.__xss", "<img src=x onerror", "<svg/onload", "</script><script>", "href=\"javascript:"];

type Probe = Window & { __xss?: number; __csp?: string[] };

async function newMerchant(browser: Browser, label: string) {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": testClientIp() } });
  const page = await context.newPage();
  const email = `${unique(label)}@example.com`;
  const signup = await page.request.post("/api/auth/signup", {
    headers: { origin },
    data: { restaurantName: `Commerce ${unique(label)}`, email, password: PASSWORD },
  });
  expect(signup.status(), await signup.text()).toBe(202);
  const signupBody = await signup.json() as { verificationToken?: string };
  expect(signupBody.verificationToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

  const verified = await page.request.post("/api/auth/verify-email", {
    headers: { origin },
    data: { token: signupBody.verificationToken },
  });
  expect(verified.ok(), await verified.text()).toBeTruthy();

  const login = await page.request.post("/api/auth/login", {
    headers: { origin, "x-real-ip": testClientIp() },
    data: { email, password: PASSWORD },
  });
  expect(login.ok(), await login.text()).toBeTruthy();

  const restaurantResponse = await page.request.get("/api/restaurant");
  expect(restaurantResponse.ok(), await restaurantResponse.text()).toBeTruthy();
  const restaurant = await restaurantResponse.json();
  return { context, page, email, restaurant };
}

async function sessionCookie(context: BrowserContext) {
  return (await context.cookies(origin)).find((cookie) => cookie.name === COOKIE)?.value;
}

async function armDetectors(page: Page) {
  await page.addInitScript(() => {
    (window as Probe).__csp = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      (window as Probe).__csp!.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  page.on("dialog", (dialog) => { throw new Error(`dialog ouvert : ${dialog.message()}`); });
}

async function expectInert(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.status(), path).toBeLessThan(400);
  const state = await page.evaluate(() => ({
    xss: (window as Probe).__xss ?? null,
    csp: (window as Probe).__csp ?? [],
    handlers: [...document.querySelectorAll("*")].flatMap((el) => [...el.attributes].filter((a) => /^on/i.test(a.name)).map((a) => `${el.tagName}[${a.name}]`)),
    jsLinks: document.querySelectorAll('a[href^="javascript:" i]').length,
    strayScripts: [...document.querySelectorAll("script")].filter((s) => !s.src && !s.nonce && (s.textContent || "").trim() !== "").length,
  }));
  expect(state, path).toEqual({ xss: null, csp: [], handlers: [], jsLinks: 0, strayScripts: 0 });

  // Le HTML exact servi à cette navigation : pas de second rendu serveur.
  const raw = await response!.text();
  for (const marker of RAW_MARKERS) expect(raw.includes(marker), `${path} contient ${marker}`).toBe(false);
  for (const script of raw.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
    expect(/[\u2028\u2029]/.test(script[1]), `${path} : U+2028/2029 brut dans un <script>`).toBe(false);
  }
}

test("XSS stocké : chaque champ persistant reste inerte sur toutes ses pages de rendu", async ({ browser }) => {
  const merchant = await newMerchant(browser, "xss-matrix");
  const { page, restaurant } = merchant;
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const patch = await page.request.patch("/api/restaurant", {
      headers: { origin },
      data: { name: P.attr, address: `${P.script}${P.scriptBreak}`, phone: P.svg, instagram: P.broken },
    });
    expect(patch.ok(), await patch.text()).toBeTruthy();
    for (const data of [{ website: "javascript:window.__xss=9" }, { logoUrl: "javascript:window.__xss=9" }, { logoUrl: "data:image/svg+xml,<svg onload=alert(1)>" }]) {
      expect((await page.request.patch("/api/restaurant", { headers: { origin }, data })).status(), JSON.stringify(data)).toBe(400);
    }

    const program = await (await page.request.get("/api/program")).json();
    const programPatch = await page.request.patch("/api/program", {
      headers: { origin },
      data: {
        mode: program.mode, pointsRule: program.points_rule, rewardThreshold: program.reward_threshold,
        stampsPerVisit: program.stamps_per_visit, pointsPerPurchase: program.points_per_purchase,
        pointsPerEuro: Number(program.points_per_euro) || 1, dailyEarnLimit: 0, cooldownSeconds: 0, expiresAfterDays: null,
        programName: P.scriptBreak, rewardLabel: `${P.attr}${P.unicode}`, cardMessage: `${P.jsLink}${P.script}`,
      },
    });
    expect(programPatch.ok(), await programPatch.text()).toBeTruthy();

    const htmlCustomer = await page.request.post("/api/enroll", {
      headers: { origin },
      data: { slug: restaurant.slug, firstName: `${P.svg}${P.unicode}`, email: `${unique("xss-c1")}@example.com`, marketingConsent: false },
    });
    expect(htmlCustomer.status()).toBe(201);
    const htmlToken = String((await htmlCustomer.json()).token);
    const formulaCustomer = await page.request.post("/api/enroll", {
      headers: { origin },
      data: { slug: restaurant.slug, firstName: "=HYPERLINK(\"https://evil.invalid\";\"x\")", email: `${unique("xss-c2")}@example.com`, marketingConsent: false },
    });
    expect(formulaCustomer.status()).toBe(201);
    const formulaToken = String((await formulaCustomer.json()).token);
    for (const token of [htmlToken, formulaToken]) {
      const credit = await page.request.post("/api/credit", { headers: { origin }, data: { token: `LOY1:${token}`, idempotencyKey: crypto.randomUUID() } });
      expect(credit.ok(), await credit.text()).toBeTruthy();
    }

    const [customer] = await sql`select id from customers where establishment_id=${restaurant.id} and first_name like '<svg%'`;
    expect((await page.request.patch(`/api/customers/${customer.id}/note`, { headers: { origin }, data: { note: P.script } })).status()).toBe(400);
    expect((await page.request.patch(`/api/customers/${customer.id}/note`, { headers: { origin }, data: { note: "\" onmouseover=window.__xss=10 x=\"" } })).ok()).toBeTruthy();

    const staff = await page.request.post("/api/employees", {
      headers: { origin },
      data: { email: `"><svg/onload=window.__xss=8>${unique("x")}@evil.io`, password: PASSWORD, role: "EMPLOYEE" },
    });
    expect(staff.ok(), await staff.text()).toBeTruthy();

    const [owner] = await sql`select id from staff_users where establishment_id=${restaurant.id} and role='OWNER'`;
    await sql`insert into platform_admins(staff_user_id, note) values(${owner.id}, 'e2e xss')`;

    await armDetectors(page);
    // Une page par surface de rendu : back-office, public, carte, super-admin.
    const paths = [
      "/dashboard", "/dashboard/settings", "/dashboard/program", "/dashboard/clients", `/dashboard/clients/${customer.id}`,
      "/dashboard/transactions", "/dashboard/employees", "/dashboard/poster",
      `/j/${restaurant.slug}`, `/c/${htmlToken}`, `/admin/establishments/${restaurant.id}`, "/admin/users",
    ];
    for (const path of paths) await expectInert(page, path);

    await page.goto("/s");
    await page.getByPlaceholder("Code court ou email").fill(String((await sql`select short_code from cards where token=${htmlToken}`)[0].short_code));
    await page.getByRole("button", { name: "Chercher" }).click();
    await expect(page.getByText(/tampons?|points?/i).first()).toBeVisible();
    expect(await page.evaluate(() => ({ xss: (window as Probe).__xss ?? null, csp: (window as Probe).__csp ?? [] }))).toEqual({ xss: null, csp: [] });

    const csv = await (await page.request.get("/api/transactions/export")).text();
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).not.toMatch(/(^|;|\r\n)"?=HYPERLINK/);
  } finally {
    await sql`delete from platform_admins where note='e2e xss'`;
    await sql.end({ timeout: 5 });
    await merchant.context.close();
  }
});

test("session : cookie rejoué après logout refusé", async ({ browser }) => {
  const merchant = await newMerchant(browser, "replay-logout");
  try {
    const stolen = await sessionCookie(merchant.context);
    expect(stolen).toBeTruthy();
    expect((await merchant.page.request.post("/api/auth/logout", { headers: { origin } })).ok()).toBeTruthy();
    await merchant.context.addCookies([{ name: COOKIE, value: stolen!, url: origin }]);
    expect((await merchant.page.request.get("/api/dashboard")).status()).toBe(401);
  } finally {
    await merchant.context.close();
  }
});

test("session : un cookie valide planté par un attaquant ne survit pas au login de la victime", async ({ browser }) => {
  const attacker = await newMerchant(browser, "fixation-attacker");
  const victim = await newMerchant(browser, "fixation-victim");
  try {
    const attackerCookie = (await sessionCookie(attacker.context))!;
    await victim.page.request.post("/api/auth/logout", { headers: { origin } });
    await victim.context.clearCookies();
    await victim.context.addCookies([{ name: COOKIE, value: attackerCookie, url: origin, httpOnly: true, sameSite: "Lax" }]);
    expect((await (await victim.page.request.get("/api/restaurant")).json()).id).toBe(attacker.restaurant.id);

    const login = await victim.page.request.post("/api/auth/login", {
      headers: { origin, "x-real-ip": testClientIp() },
      data: { email: victim.email, password: PASSWORD },
    });
    expect(login.ok()).toBeTruthy();
    const victimCookie = await sessionCookie(victim.context);
    expect(victimCookie).not.toBe(attackerCookie);
    expect((await (await victim.page.request.get("/api/restaurant")).json()).id).toBe(victim.restaurant.id);
    // Le jeton gardé par l'attaquant ne donne toujours accès qu'à son propre compte.
    expect((await (await attacker.page.request.get("/api/restaurant")).json()).id).toBe(attacker.restaurant.id);
  } finally {
    await attacker.context.close();
    await victim.context.close();
  }
});

test("session : JWT falsifié (autre commerce, alg none) refusé", async ({ browser }) => {
  const a = await newMerchant(browser, "forge-a");
  const b = await newMerchant(browser, "forge-b");
  try {
    const token = (await sessionCookie(b.context))!;
    const [header, payload, signature] = token.split(".");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    const forgedPayload = Buffer.from(JSON.stringify({ ...claims, establishmentId: a.restaurant.id })).toString("base64url");
    const noneHeader = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    for (const forged of [`${header}.${forgedPayload}.${signature}`, `${noneHeader}.${forgedPayload}.`, `${noneHeader}.${payload}.`]) {
      await b.context.clearCookies();
      await b.context.addCookies([{ name: COOKIE, value: forged, url: origin }]);
      expect((await b.page.request.get("/api/restaurant")).status(), forged.slice(0, 20)).toBe(401);
    }
  } finally {
    await a.context.close();
    await b.context.close();
  }
});

test("session : un changement de mot de passe révoque aussi l'autre appareil", async ({ browser }) => {
  const merchant = await newMerchant(browser, "password-devices");
  const second = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": testClientIp() } });
  try {
    await second.addCookies([{ name: COOKIE, value: (await sessionCookie(merchant.context))!, url: origin }]);
    const secondPage = await second.newPage();
    expect((await secondPage.request.get("/api/dashboard")).status()).toBe(200);
    const change = await merchant.page.request.post("/api/auth/change-password", {
      headers: { origin },
      data: { currentPassword: PASSWORD, newPassword: "Another-password-456!" },
    });
    expect(change.ok(), await change.text()).toBeTruthy();
    expect((await secondPage.request.get("/api/dashboard")).status()).toBe(401);
    expect((await merchant.page.request.get("/api/dashboard")).status()).toBe(401);
  } finally {
    await second.close();
    await merchant.context.close();
  }
});
