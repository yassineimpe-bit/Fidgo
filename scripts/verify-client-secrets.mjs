import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const sourceExtensions = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const staticArtifactExtensions = new Set([".css", ".js", ".json", ".map", ".txt"]);
const renderedArtifactExtensions = new Set([".body", ".html", ".json", ".rsc", ".txt"]);
const sensitiveEnvName = /(?:^|_)(?:API_KEY|AUTH_SECRET|CERT_BASE64|CREDENTIALS?|DATABASE_URL|KEY_BASE64|KEY_PASSPHRASE|PASSWORD|PRIVATE_KEY|SECRET|SERVICE_ACCOUNT_JSON_BASE64|TOKEN|WEBHOOK_SECRET)(?:$|_)/;
const publicEnvNames = new Set(["NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_VAPID_PUBLIC_KEY"]);

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(absolute) : [absolute];
  }));
  return nested.flat();
}

function envAccesses(source) {
  const names = new Set();
  const pattern = /process\.env(?:\.([A-Z0-9_]+)|\[["']([A-Z0-9_]+)["']\])/g;
  for (const match of source.matchAll(pattern)) names.add(match[1] || match[2]);
  return {
    names: [...names],
    dynamic: source.replace(pattern, "").includes("process.env"),
  };
}

async function clientSourceViolations() {
  const sourceFiles = (await Promise.all(["app", "components", "lib"].map((directory) => filesBelow(path.join(root, directory)))))
    .flat()
    .filter((file) => sourceExtensions.has(path.extname(file)));
  const violations = [];

  for (const file of sourceFiles) {
    const source = await readFile(file, "utf8");
    if (!/^\s*["']use client["'];/m.test(source)) continue;
    const accesses = envAccesses(source);
    const privateNames = accesses.names.filter((name) => !publicEnvNames.has(name));
    if (accesses.dynamic) privateNames.push("DYNAMIC_PROCESS_ENV");
    if (privateNames.length) {
      violations.push({ file: path.relative(root, file), keys: privateNames });
    }
  }
  return violations;
}

function sensitiveValues() {
  const entries = [];
  for (const [key, value] of Object.entries(process.env)) {
    if (publicEnvNames.has(key) || !sensitiveEnvName.test(key) || !value || value.length < 8) continue;
    const variants = new Set([value, JSON.stringify(value).slice(1, -1), encodeURIComponent(value)]);
    entries.push({ key, variants: [...variants].filter((variant) => variant.length >= 8) });
  }
  return entries;
}

const credentialPatterns = [
  { name: "PRIVATE_KEY_PEM", pattern: /-----BEGIN (?:EC |RSA )?PRIVATE KEY-----/ },
  { name: "POSTGRES_CREDENTIALS", pattern: /postgres(?:ql)?:\/\/[^\s/:]+:[^\s@]+@/ },
  { name: "RESEND_API_KEY", pattern: /\bre_[A-Za-z0-9_-]{16,}\b/ },
  { name: "GITHUB_TOKEN", pattern: /\b(?:ghp_|github_pat_)[A-Za-z0-9_]{12,}\b/ },
  { name: "NEON_API_KEY", pattern: /\bnapi_[A-Za-z0-9_-]{12,}\b/ },
  { name: "STRIPE_LIVE_KEY", pattern: /\b(?:sk|rk)_live_[A-Za-z0-9]{12,}\b/ },
  { name: "STRIPE_WEBHOOK_SECRET", pattern: /\bwhsec_[A-Za-z0-9]{12,}\b/ },
];

async function artifactLeaks() {
  const staticArtifacts = (await filesBelow(path.join(root, ".next", "static")))
    .filter((file) => staticArtifactExtensions.has(path.extname(file)));
  const renderedArtifacts = [
    ...(await filesBelow(path.join(root, ".next", "server", "app"))),
    ...(await filesBelow(path.join(root, ".next", "server", "pages"))),
  ].filter((file) => renderedArtifactExtensions.has(path.extname(file)));
  const artifacts = [...staticArtifacts, ...renderedArtifacts];
  if (!artifacts.length) throw new Error("CLIENT_ARTIFACTS_NOT_FOUND: run npm run build first");

  const secrets = sensitiveValues();
  const leaks = [];
  for (const file of artifacts) {
    const content = await readFile(file, "utf8");
    const keys = secrets
      .filter(({ variants }) => variants.some((value) => content.includes(value)))
      .map(({ key }) => key);
    const patterns = credentialPatterns.filter(({ pattern }) => pattern.test(content)).map(({ name }) => name);
    if (keys.length || patterns.length) {
      leaks.push({ file: path.relative(root, file), keys: [...new Set([...keys, ...patterns])] });
    }
  }
  return { artifacts: artifacts.length, leaks };
}

const sourceViolations = await clientSourceViolations();
const result = await artifactLeaks();
if (sourceViolations.length || result.leaks.length) {
  console.error("Client secret audit failed.");
  for (const violation of sourceViolations) console.error(`- ${violation.file}: server env access (${violation.keys.join(", ")})`);
  for (const leak of result.leaks) console.error(`- ${leak.file}: sensitive value (${leak.keys.join(", ")})`);
  process.exit(1);
}

console.log(`Client secret audit OK: ${result.artifacts} browser artifacts scanned; no private env access in client modules.`);
