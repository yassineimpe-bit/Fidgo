function envValue(key) {
  return process.env[key]?.trim() || "";
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const required = ["DATABASE_URL", "AUTH_SECRET", "NEXT_PUBLIC_APP_URL"];
const missing = required.filter((key) => !envValue(key));
if (missing.length) fail(`Variables manquantes: ${missing.join(", ")}`);

const authSecret = envValue("AUTH_SECRET");
if (Buffer.byteLength(authSecret, "utf8") < 32) {
  fail("AUTH_SECRET doit contenir au moins 32 octets.");
}

try {
  const databaseUrl = new URL(envValue("DATABASE_URL"));
  if (!["postgres:", "postgresql:"].includes(databaseUrl.protocol)) {
    throw new Error("DATABASE_URL doit utiliser postgres:// ou postgresql://.");
  }
  if (!databaseUrl.hostname || !databaseUrl.pathname || databaseUrl.pathname === "/") {
    throw new Error("DATABASE_URL doit contenir un hôte et une base de données.");
  }
} catch (error) {
  fail(error instanceof Error ? error.message : "DATABASE_URL invalide.");
}

try {
  const appUrl = new URL(envValue("NEXT_PUBLIC_APP_URL"));
  if (appUrl.username || appUrl.password || appUrl.search || appUrl.hash || (appUrl.pathname && appUrl.pathname !== "/")) {
    throw new Error("NEXT_PUBLIC_APP_URL doit être une origine sans identifiants, chemin, query ni fragment.");
  }
  if (process.env.NODE_ENV === "production") {
    if (appUrl.protocol !== "https:") throw new Error("NEXT_PUBLIC_APP_URL doit utiliser HTTPS en production.");
    if (appUrl.origin !== "https://retiko.fr") {
      throw new Error("NEXT_PUBLIC_APP_URL doit être https://retiko.fr en production.");
    }
  }
} catch (error) {
  fail(error instanceof Error ? error.message : "NEXT_PUBLIC_APP_URL invalide.");
}

for (const flag of ["APPLE_WALLET_ENABLED", "GOOGLE_WALLET_ENABLED", "CARD_RECOVERY_ENABLED"]) {
  const value = envValue(flag);
  if (value && value !== "true" && value !== "false") {
    fail(`${flag} doit valoir true ou false.`);
  }
}

if (envValue("APPLE_WALLET_ENABLED") === "true") {
  const apple = ["APPLE_PASS_TYPE_IDENTIFIER", "APPLE_TEAM_IDENTIFIER", "APPLE_WWDR_CERT_BASE64", "APPLE_SIGNER_CERT_BASE64", "APPLE_SIGNER_KEY_BASE64"];
  const appleMissing = apple.filter((key) => !envValue(key));
  if (appleMissing.length) fail(`Apple Wallet activé mais variables manquantes: ${appleMissing.join(", ")}`);
}

if (envValue("GOOGLE_WALLET_ENABLED") === "true") {
  const google = ["GOOGLE_WALLET_ISSUER_ID", "GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_BASE64"];
  const googleMissing = google.filter((key) => !envValue(key));
  if (googleMissing.length) fail(`Google Wallet activé mais variables manquantes: ${googleMissing.join(", ")}`);
  try {
    const creds = JSON.parse(Buffer.from(envValue("GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_BASE64"), "base64").toString("utf8"));
    if (!creds.client_email || !creds.private_key) throw new Error("service account incomplet");
  } catch (error) {
    fail(`GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_BASE64 invalide: ${error instanceof Error ? error.message : "JSON invalide"}`);
  }
}

if (envValue("CARD_RECOVERY_ENABLED") === "true") {
  const recovery = ["RESEND_API_KEY", "EMAIL_FROM"];
  const recoveryMissing = recovery.filter((key) => !envValue(key));
  if (recoveryMissing.length) fail(`Récupération email activée mais variables manquantes: ${recoveryMissing.join(", ")}`);

  if (process.env.NODE_ENV === "production") {
    const from = envValue("EMAIL_FROM");
    const match = from.match(/(?:<)?[^<>\s@]+@([^<>\s]+)>?$/i);
    const host = match?.[1]?.toLowerCase();
    if (!host || (host !== "retiko.fr" && !host.endsWith(".retiko.fr"))) {
      fail("EMAIL_FROM doit utiliser retiko.fr ou un sous-domaine vérifié de retiko.fr en production.");
    }
  }
}

console.log("Environnement valide.");
