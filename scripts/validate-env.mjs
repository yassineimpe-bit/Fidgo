function envValue(key) {
  return process.env[key]?.trim() || "";
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function emailAddress(value) {
  const match = value.match(/^(?:[^<>\r\n]+\s*)?<([^<>\s@]+@[^<>\s@]+)>$|^([^<>\s@]+@[^<>\s@]+)$/i);
  return (match?.[1] || match?.[2] || "").toLowerCase();
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

// Non bloquant : sans CRON_SECRET, /api/cron/purge reste ferme (401) et la
// purge quotidienne ne tourne simplement pas. Mais un secret trop court est
// une fausse securite, donc on refuse.
const cronSecret = envValue("CRON_SECRET");
if (cronSecret && Buffer.byteLength(cronSecret, "utf8") < 16) {
  fail("CRON_SECRET doit contenir au moins 16 octets.");
}
if (!cronSecret && process.env.NODE_ENV === "production") {
  console.warn("Avertissement: CRON_SECRET absent, la purge /api/cron/purge restera inactive.");
}

for (const flag of ["APPLE_WALLET_ENABLED", "GOOGLE_WALLET_ENABLED", "CARD_RECOVERY_ENABLED", "STRIPE_ENABLED", "STRIPE_AUTOMATIC_TAX_ENABLED"]) {
  const value = envValue(flag);
  if (value && value !== "true" && value !== "false") {
    fail(`${flag} doit valoir true ou false.`);
  }
}

if (envValue("STRIPE_ENABLED") === "true") {
  const stripe = [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_PRICE_FLEX_MONTHLY",
    "STRIPE_PRICE_RETIKO12_MONTHLY",
    "STRIPE_PRICE_ANNUAL",
  ];
  const stripeMissing = stripe.filter((key) => !envValue(key));
  if (stripeMissing.length) fail(`Stripe activé mais variables manquantes: ${stripeMissing.join(", ")}`);
  if (!envValue("STRIPE_SECRET_KEY").startsWith("sk_")) fail("STRIPE_SECRET_KEY doit commencer par sk_.");
  if (!envValue("STRIPE_WEBHOOK_SECRET").startsWith("whsec_")) fail("STRIPE_WEBHOOK_SECRET doit commencer par whsec_.");
  const priceIds = [
    envValue("STRIPE_PRICE_FLEX_MONTHLY"),
    envValue("STRIPE_PRICE_RETIKO12_MONTHLY"),
    envValue("STRIPE_PRICE_ANNUAL"),
  ];
  if (priceIds.some((value) => !value.startsWith("price_"))) fail("Chaque Price ID Stripe doit commencer par price_.");
  if (new Set(priceIds).size !== priceIds.length) fail("Les trois Price IDs Stripe doivent être distincts.");
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

const transactionalEmailRequired =
  process.env.NODE_ENV === "production" || envValue("CARD_RECOVERY_ENABLED") === "true";

if (transactionalEmailRequired) {
  const email = ["RESEND_API_KEY", "EMAIL_FROM", "EMAIL_REPLY_TO"];
  const emailMissing = email.filter((key) => !envValue(key));
  if (emailMissing.length) {
    const reason = process.env.NODE_ENV === "production"
      ? "Vérification e-mail des comptes commerçants"
      : "Récupération email";
    fail(`${reason} requise mais variables manquantes: ${emailMissing.join(", ")}`);
  }

  if (!envValue("RESEND_API_KEY").startsWith("re_")) {
    fail("RESEND_API_KEY doit être une clé Resend valide commençant par re_.");
  }

  const fromAddress = emailAddress(envValue("EMAIL_FROM"));
  const replyAddress = emailAddress(envValue("EMAIL_REPLY_TO"));
  if (!fromAddress) fail("EMAIL_FROM doit être une adresse email valide, avec un nom d'expéditeur optionnel.");
  if (!replyAddress) fail("EMAIL_REPLY_TO doit être une adresse email valide et surveillée.");
  if (/^(?:no-?reply)@/i.test(replyAddress)) {
    fail("EMAIL_REPLY_TO doit être une boîte surveillée, pas une adresse noreply.");
  }

  if (process.env.NODE_ENV === "production") {
    const fromHost = fromAddress.split("@")[1];
    const replyHost = replyAddress.split("@")[1];
    if (fromHost !== "retiko.fr" && !fromHost.endsWith(".retiko.fr")) {
      fail("EMAIL_FROM doit utiliser retiko.fr ou un sous-domaine vérifié de retiko.fr en production.");
    }
    if (replyHost !== "retiko.fr" && !replyHost.endsWith(".retiko.fr")) {
      fail("EMAIL_REPLY_TO doit utiliser retiko.fr ou un sous-domaine de retiko.fr en production.");
    }
  }
}

console.log("Environnement valide.");
