const required = ["DATABASE_URL", "AUTH_SECRET", "NEXT_PUBLIC_APP_URL"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Variables manquantes: ${missing.join(", ")}`);
  process.exit(1);
}
if (process.env.AUTH_SECRET.length < 32) {
  console.error("AUTH_SECRET doit contenir au moins 32 caractères.");
  process.exit(1);
}
try {
  const url = new URL(process.env.NEXT_PUBLIC_APP_URL);
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") throw new Error("NEXT_PUBLIC_APP_URL doit utiliser HTTPS en production.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "NEXT_PUBLIC_APP_URL invalide.");
  process.exit(1);
}

if (process.env.APPLE_WALLET_ENABLED === "true") {
  const apple = ["APPLE_PASS_TYPE_IDENTIFIER", "APPLE_TEAM_IDENTIFIER", "APPLE_WWDR_CERT_BASE64", "APPLE_SIGNER_CERT_BASE64", "APPLE_SIGNER_KEY_BASE64"];
  const appleMissing = apple.filter((key) => !process.env[key]);
  if (appleMissing.length) {
    console.error(`Apple Wallet activé mais variables manquantes: ${appleMissing.join(", ")}`);
    process.exit(1);
  }
}

if (process.env.GOOGLE_WALLET_ENABLED === "true") {
  const google = ["GOOGLE_WALLET_ISSUER_ID", "GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_BASE64"];
  const googleMissing = google.filter((key) => !process.env[key]);
  if (googleMissing.length) {
    console.error(`Google Wallet activé mais variables manquantes: ${googleMissing.join(", ")}`);
    process.exit(1);
  }
  try {
    const creds = JSON.parse(Buffer.from(process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_BASE64, "base64").toString("utf8"));
    if (!creds.client_email || !creds.private_key) throw new Error("service account incomplet");
  } catch (error) {
    console.error(`GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_BASE64 invalide: ${error instanceof Error ? error.message : "JSON invalide"}`);
    process.exit(1);
  }
}

console.log("Environnement valide.");
