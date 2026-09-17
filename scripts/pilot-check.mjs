import { spawnSync } from "node:child_process";

const databaseUrl = process.env.DATABASE_URL;

function fail(message) {
  console.error(`pilot:check refusé : ${message}`);
  process.exit(1);
}

if (!databaseUrl) fail("DATABASE_URL est requis et doit viser une base locale dédiée aux tests.");
if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") {
  fail("un environnement déclaré production ne peut jamais exécuter ce contrôle destructif de test.");
}

let target;
try {
  target = new URL(databaseUrl);
} catch {
  fail("DATABASE_URL n'est pas une URL PostgreSQL valide.");
}

if (!["postgres:", "postgresql:"].includes(target.protocol)) {
  fail("DATABASE_URL doit utiliser le protocole postgres ou postgresql.");
}

const localHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const databaseName = decodeURIComponent(target.pathname.replace(/^\/+/, ""));
if (!localHosts.has(target.hostname) || !/test/i.test(databaseName)) {
  fail("la cible doit être une PostgreSQL locale dont le nom contient 'test' (jamais Neon/production).");
}

const stages = [
  ["typecheck", "Contrôles automatisés : types"],
  ["lint", "Contrôles automatisés : lint"],
  ["test", "Contrôles automatisés : tests unitaires"],
  ["build", "Contrôles automatisés : build"],
  ["db:setup", "Base dédiée : schéma et migrations"],
  ["db:verify", "Base dédiée : intégrité avant E2E"],
  ["test:e2e", "Base dédiée : parcours E2E et rush 30 opérations"],
  ["db:verify", "Base dédiée : intégrité après E2E"],
];

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
for (const [script, label] of stages) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(npm, ["run", script], {
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log("\nAutomatisé : OK.");
console.log("Production smoke : à vérifier séparément via le workflow GitHub production-smoke.");
console.log("Physique : iPhone/Android, caméra réelle et rush terrain restent obligatoires.");
