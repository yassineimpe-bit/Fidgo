type Advisory = { name: string; severity: "moderate" | "high" | "critical"; url: string; source: number };
type Via = string | Advisory;

export function advisory(id: string, severity: Advisory["severity"], name = "node-forge"): Advisory {
  return { name, severity, url: `https://github.com/advisories/${id}`, source: 1 };
}

export function auditReport(entries: Record<string, { severity: Advisory["severity"]; via: Via[] }>) {
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
  for (const entry of Object.values(entries)) {
    counts[entry.severity] += 1;
    counts.total += 1;
  }
  return { auditReportVersion: 2, vulnerabilities: entries, metadata: { vulnerabilities: counts } };
}

export const allowedNodeForge = advisory("GHSA-86w9-cpqp-85rv", "high");
export const allowedBraces = advisory("GHSA-vfj7-8cjw-p6xm", "high", "braces");

// Les deux exceptions de 2026-10, retirées de la production le 2026-11-26.
// Conservées ici pour continuer à tester le mécanisme d'exception ciblée.
export const historicalExceptions = new Map([
  ["GHSA-86w9-cpqp-85rv", {
    packageName: "node-forge", severity: "high" as const, cve: "CVE-2026-85393",
    introducedOn: "2026-10-02", reviewThrough: "2026-10-16",
    removeWhen: "A corrected node-forge version is published and validated through passkit-generator.",
  }],
  ["GHSA-vfj7-8cjw-p6xm", {
    packageName: "braces", severity: "high" as const, cve: "CVE-2026-93687",
    introducedOn: "2026-10-03", reviewThrough: "2026-10-16",
    removeWhen: "A corrected braces version is published and validated through the lint tooling.",
  }],
]);
