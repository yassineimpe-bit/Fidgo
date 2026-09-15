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
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("NEXT_PUBLIC_APP_URL doit utiliser HTTPS en production.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "NEXT_PUBLIC_APP_URL invalide.");
  process.exit(1);
}

console.log("Environnement valide.");
