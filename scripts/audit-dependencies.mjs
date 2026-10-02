import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const ALLOWED_ADVISORIES = new Map([
  [
    "GHSA-86w9-cpqp-85rv",
    {
      packageName: "node-forge",
      severity: "high",
      cve: "CVE-2026-85393",
      introducedOn: "2026-10-02",
      reviewThrough: "2026-10-16",
      removeWhen: "A corrected node-forge version is published and validated through passkit-generator.",
    },
  ],
]);

const BLOCKING_SEVERITIES = new Set(["high", "critical"]);

function advisoryId(url) {
  const match = String(url || "").match(/github\.com\/advisories\/(GHSA-[a-z0-9-]+)\/?$/i);
  return match?.[1] || null;
}

function utcDay(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error("AUDIT_GATE_INVALID_DATE");
  return date.toISOString().slice(0, 10);
}

function collectAdvisories(packageName, vulnerabilities, visiting = new Set()) {
  if (visiting.has(packageName)) return { advisories: [], unresolved: [`cycle:${packageName}`] };
  const entry = vulnerabilities[packageName];
  if (!entry) return { advisories: [], unresolved: [`missing:${packageName}`] };

  const nextVisiting = new Set(visiting).add(packageName);
  const advisories = [];
  const unresolved = [];
  for (const via of Array.isArray(entry.via) ? entry.via : []) {
    if (typeof via === "string") {
      const nested = collectAdvisories(via, vulnerabilities, nextVisiting);
      advisories.push(...nested.advisories);
      unresolved.push(...nested.unresolved);
    } else if (via && typeof via === "object") {
      advisories.push(via);
    } else {
      unresolved.push(`invalid:${packageName}`);
    }
  }
  return { advisories, unresolved };
}

export function evaluateAuditReport(report, { now = new Date() } = {}) {
  const failures = [];
  const allowed = [];
  const today = utcDay(now);

  for (const [id, exception] of ALLOWED_ADVISORIES) {
    if (today > exception.reviewThrough) failures.push(`${id} exception expired after ${exception.reviewThrough}`);
  }

  if (!report || report.auditReportVersion !== 2 || !report.vulnerabilities || typeof report.vulnerabilities !== "object") {
    failures.push("Unsupported or malformed npm audit report");
    return { ok: false, failures, allowed };
  }

  const vulnerabilities = report.vulnerabilities;
  const blockingEntries = Object.entries(vulnerabilities).filter(([, entry]) => BLOCKING_SEVERITIES.has(String(entry?.severity || "").toLowerCase()));
  const metadata = report.metadata?.vulnerabilities || {};
  const metadataBlocking = Number(metadata.high || 0) + Number(metadata.critical || 0);
  if (metadataBlocking > 0 && blockingEntries.length === 0) failures.push("npm reports HIGH/CRITICAL vulnerabilities without resolvable entries");
  if (Number(metadata.critical || 0) > 0 && !blockingEntries.some(([, entry]) => String(entry?.severity || "").toLowerCase() === "critical")) {
    failures.push("npm reports CRITICAL vulnerabilities without a CRITICAL entry");
  }

  const seenAllowed = new Set();
  for (const [packageName, entry] of blockingEntries) {
    const entrySeverity = String(entry.severity || "").toLowerCase();
    if (entrySeverity === "critical") failures.push(`${packageName} is CRITICAL`);

    const { advisories, unresolved } = collectAdvisories(packageName, vulnerabilities);
    if (unresolved.length) failures.push(`${packageName} has unresolved advisory paths`);
    const blockingAdvisories = advisories.filter((advisory) => BLOCKING_SEVERITIES.has(String(advisory?.severity || "").toLowerCase()));
    if (!blockingAdvisories.length) failures.push(`${packageName} has no named HIGH/CRITICAL advisory`);

    for (const advisory of blockingAdvisories) {
      const severity = String(advisory.severity || "").toLowerCase();
      const id = advisoryId(advisory.url);
      const exception = id ? ALLOWED_ADVISORIES.get(id) : null;
      const exactMatch = exception
        && severity === exception.severity
        && advisory.name === exception.packageName
        && advisory.url === `https://github.com/advisories/${id}`;
      if (!exactMatch) {
        failures.push(`${id || advisory.url || advisory.name || "unknown advisory"} is not allowlisted`);
        continue;
      }
      seenAllowed.add(id);
    }
  }

  for (const id of seenAllowed) {
    const exception = ALLOWED_ADVISORIES.get(id);
    allowed.push({ id, cve: exception.cve, reviewThrough: exception.reviewThrough });
  }

  return { ok: failures.length === 0, failures: [...new Set(failures)], allowed };
}

export function runAudit({ now = new Date() } = {}) {
  const audit = spawnSync("npm", ["audit", "--json"], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  if (audit.error || audit.signal || !audit.stdout) {
    console.error("Dependency audit could not be executed.");
    return 1;
  }

  let report;
  try {
    report = JSON.parse(audit.stdout);
  } catch {
    console.error("Dependency audit returned invalid JSON.");
    return 1;
  }

  const result = evaluateAuditReport(report, { now });
  for (const item of result.allowed) {
    console.warn(`Temporarily accepted ${item.id} (${item.cve}); review through ${item.reviewThrough}.`);
  }
  if (!result.ok) {
    for (const failure of result.failures) console.error(`Dependency audit rejected: ${failure}`);
    return 1;
  }

  console.log(result.allowed.length ? "Dependency audit passed with one targeted temporary exception." : "Dependency audit passed with no HIGH/CRITICAL advisories.");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runAudit();
}
