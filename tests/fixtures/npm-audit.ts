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
