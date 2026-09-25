import { expect, test, type APIResponse, type Page } from "@playwright/test";
import { createMerchant, origin } from "./helpers";

const FALLBACK_SENTINELS: Array<[string, string]> = [
  ["AUTH_SECRET", "fidgo-playwright-secret-at-least-32-characters"],
  ["RESEND_API_KEY", "re_test_dummy_key"],
  ["STRIPE_SECRET_KEY", "sk_test_e2e_placeholder"],
  ["STRIPE_WEBHOOK_SECRET", "whsec_retiko_e2e"],
  ["GITHUB_TOKEN", "github_pat_retiko_client_secret_sentinel"],
  ["NEON_API_KEY", "napi_retiko_client_secret_sentinel"],
];

const ENV_KEYS = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "CRON_SECRET",
  "RESEND_API_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "APPLE_WWDR_CERT_BASE64",
  "APPLE_SIGNER_CERT_BASE64",
  "APPLE_SIGNER_KEY_BASE64",
  "APPLE_SIGNER_KEY_PASSPHRASE",
  "GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_BASE64",
  "FIDGO_GITHUB_TOKEN",
  "NEON_API_KEY",
  "VAPID_PRIVATE_KEY",
  "DEMO_OWNER_PASSWORD",
] as const;

function secretsUnderTest() {
  const values = [...FALLBACK_SENTINELS];
  for (const key of ENV_KEYS) {
    const value = process.env[key];
    if (value && value.length >= 8) values.push([key, value]);
  }
  return values.filter((entry, index) => values.findIndex(([, value]) => value === entry[1]) === index);
}

function leakedKeys(content: string) {
  return secretsUnderTest().filter(([, value]) => content.includes(value)).map(([key]) => key);
}

async function expectResponseWithoutSecrets(response: APIResponse, label: string) {
  const body = await response.text();
  const content = `${JSON.stringify(response.headers())}\n${body}`;
  expect(leakedKeys(content), `${label} expose une valeur serveur`).toEqual([]);
  return body;
}

function forbiddenFields(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((item, index) => forbiddenFields(item, `${prefix}[${index}]`));
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    const field = prefix ? `${prefix}.${key}` : key;
    const own = /(?:password_hash|token_hash|authentication_token|database_url|databaseUrl|private_key|service_account|api_key|secret|stack|trace)/i.test(key)
      ? [field]
      : [];
    return [...own, ...forbiddenFields(child, field)];
  });
}

async function loadedScripts(page: Page) {
  return page.locator("script[src]").evaluateAll((scripts) => scripts
    .map((script) => (script as HTMLScriptElement).src)
    .filter(Boolean));
}

test("secrets client : pages, API et bundles ne publient aucune valeur serveur", async ({ page }) => {
  const publicPaths = [
    "/",
    "/login",
    "/signup",
    "/forgot-password",
    "/manifest.webmanifest",
    "/sw.js",
    "/api/health",
  ];
  for (const path of publicPaths) {
    const response = await page.request.get(path);
    expect([200, 503], `${path} doit répondre sans erreur inattendue`).toContain(response.status());
    await expectResponseWithoutSecrets(response, path);
  }

  const protectedEndpoints = [
    await page.request.post("/api/internal/backup-credentials"),
    await page.request.get("/api/cron/purge"),
    await page.request.post("/api/billing/webhook", { data: "{}" }),
  ];
  for (const response of protectedEndpoints) {
    expect([400, 401], `${response.url()} doit refuser une requête anonyme`).toContain(response.status());
    await expectResponseWithoutSecrets(response, new URL(response.url()).pathname);
  }

  const publicErrors = [
    await page.request.post("/api/auth/login", {
      headers: { origin },
      data: { email: "invalid", password: "" },
    }),
    await page.request.get("/api/card/not-a-valid-token"),
  ];
  for (const response of publicErrors) {
    expect(response.status()).toBeGreaterThanOrEqual(400);
    const body = await expectResponseWithoutSecrets(response, new URL(response.url()).pathname);
    expect(forbiddenFields(JSON.parse(body)), `${response.url()} publie une trace ou un champ sensible`).toEqual([]);
  }

  await createMerchant(page, "client-secrets");
  const sessionCookie = (await page.context().cookies()).find((cookie) => cookie.name === "loyalty_staff");
  expect(sessionCookie).toBeTruthy();
  expect(sessionCookie?.httpOnly).toBe(true);
  expect(sessionCookie?.sameSite).toBe("Lax");
  expect(await page.evaluate(() => document.cookie.split(";").some((cookie) => cookie.trim().startsWith("loyalty_staff=")))).toBe(false);

  const authenticatedPaths = [
    "/dashboard",
    "/dashboard/settings",
    "/dashboard/program",
    "/dashboard/wallet",
    "/api/restaurant",
    "/api/program",
    "/api/employees",
  ];
  const scriptUrls = new Set<string>();
  for (const path of authenticatedPaths) {
    const response = await page.goto(path);
    expect(response?.ok(), `${path} doit répondre`).toBeTruthy();
    if (path.startsWith("/api/")) {
      const apiResponse = await page.request.get(path);
      const body = await expectResponseWithoutSecrets(apiResponse, path);
      expect(forbiddenFields(JSON.parse(body)), `${path} renvoie un champ sensible`).toEqual([]);
    } else {
      const html = await response!.text();
      expect(leakedKeys(`${JSON.stringify(response!.headers())}\n${html}`), `${path} expose une valeur serveur`).toEqual([]);
      for (const url of await loadedScripts(page)) scriptUrls.add(url);
    }
  }

  expect(scriptUrls.size).toBeGreaterThan(0);
  for (const url of scriptUrls) {
    const response = await page.request.get(url);
    expect(response.ok(), `${url} doit être lisible`).toBeTruthy();
    await expectResponseWithoutSecrets(response, new URL(url).pathname);
  }
});
