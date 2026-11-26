import { describe, expect, it } from "vitest";
import { evaluateAuditReport } from "../scripts/audit-dependencies.mjs";
import { advisory, allowedBraces, allowedNodeForge, auditReport } from "./fixtures/npm-audit";

const beforeReview = new Date("2026-10-16T12:00:00Z");

function nodeForgeChain(extra: Record<string, { severity: "moderate" | "high" | "critical"; via: Array<string | ReturnType<typeof advisory>> }> = {}) {
  return auditReport({
    "node-forge": { severity: "high", via: [allowedNodeForge] },
    "passkit-generator": { severity: "high", via: ["node-forge"] },
    ...extra,
  });
}

const bracesChain = {
  braces: { severity: "high" as const, via: [allowedBraces] },
  micromatch: { severity: "high" as const, via: ["braces"] },
  "fast-glob": { severity: "high" as const, via: ["micromatch"] },
  "@next/eslint-plugin-next": { severity: "high" as const, via: ["fast-glob"] },
  "eslint-config-next": { severity: "high" as const, via: ["@next/eslint-plugin-next"] },
};

describe("targeted npm audit gate", () => {
  it("accepts a report with no HIGH or CRITICAL advisory", () => {
    const report = auditReport({ moderate: { severity: "moderate", via: [advisory("GHSA-mode-rate-test", "moderate", "moderate")] } });
    expect(evaluateAuditReport(report, { now: beforeReview }).ok).toBe(true);
  });

  it("accepts only the named node-forge HIGH advisory before review expiry", () => {
    expect(evaluateAuditReport(nodeForgeChain(), { now: beforeReview })).toMatchObject({ ok: true, failures: [] });
  });

  it("accepts only the named braces HIGH advisory through every lint parent", () => {
    expect(evaluateAuditReport(auditReport(bracesChain), { now: beforeReview })).toMatchObject({
      ok: true, failures: [],
      allowed: [{ id: "GHSA-vfj7-8cjw-p6xm", cve: "CVE-2026-93687", reviewThrough: "2026-10-16" }],
    });
  });

  it("accepts both exact advisories and rejects an additional HIGH", () => {
    const report = nodeForgeChain(bracesChain);
    expect(evaluateAuditReport(report, { now: beforeReview })).toMatchObject({ ok: true, failures: [] });
    expect(evaluateAuditReport(report, { now: beforeReview }).allowed).toHaveLength(2);
    report.vulnerabilities.other = { severity: "high", via: [advisory("GHSA-aaaa-bbbb-cccc", "high", "other")] };
    expect(evaluateAuditReport(report, { now: beforeReview }).ok).toBe(false);
  });

  it("rejects a different HIGH on braces even beside the allowed braces advisory", () => {
    const report = auditReport({ braces: { severity: "high", via: [allowedBraces, advisory("GHSA-aaaa-bbbb-cccc", "high", "braces")] } });
    expect(evaluateAuditReport(report, { now: beforeReview }).ok).toBe(false);
  });

  it("rejects the braces identifier when assigned to another package", () => {
    const report = auditReport({ other: { severity: "high", via: [advisory("GHSA-vfj7-8cjw-p6xm", "high", "other")] } });
    expect(evaluateAuditReport(report, { now: beforeReview }).ok).toBe(false);
  });

  it("rejects CRITICAL even with both allowed HIGH advisories or the allowed identifier", () => {
    expect(evaluateAuditReport(nodeForgeChain({ ...bracesChain, critical: { severity: "critical", via: [advisory("GHSA-crit-ical-test", "critical", "critical")] } }), { now: beforeReview }).ok).toBe(false);
    expect(evaluateAuditReport(auditReport({ braces: { severity: "critical", via: [advisory("GHSA-vfj7-8cjw-p6xm", "critical", "braces")] } }), { now: beforeReview }).ok).toBe(false);
  });

  it("expires braces alone and both exceptions immediately after the review day", () => {
    const now = new Date("2026-10-17T00:00:00Z");
    for (const report of [auditReport(bracesChain), nodeForgeChain(bracesChain)]) {
      const result = evaluateAuditReport(report, { now });
      expect(result.ok).toBe(false);
      expect(result.failures).toContain("GHSA-vfj7-8cjw-p6xm exception expired after 2026-10-16");
    }
  });

  it("rejects the allowlisted advisory plus another HIGH advisory", () => {
    const report = nodeForgeChain({ other: { severity: "high", via: [advisory("GHSA-aaaa-bbbb-cccc", "high", "other")] } });
    expect(evaluateAuditReport(report, { now: beforeReview }).ok).toBe(false);
  });

  it("rejects another HIGH advisory on its own", () => {
    const report = auditReport({ other: { severity: "high", via: [advisory("GHSA-aaaa-bbbb-cccc", "high", "other")] } });
    expect(evaluateAuditReport(report, { now: beforeReview }).ok).toBe(false);
  });

  it("rejects the allowlisted identifier when it is reported for another package", () => {
    const report = auditReport({ other: { severity: "high", via: [advisory("GHSA-86w9-cpqp-85rv", "high", "other")] } });
    expect(evaluateAuditReport(report, { now: beforeReview }).ok).toBe(false);
  });

  it("rejects every CRITICAL advisory", () => {
    const report = auditReport({ critical: { severity: "critical", via: [advisory("GHSA-crit-ical-test", "critical", "critical")] } });
    expect(evaluateAuditReport(report, { now: beforeReview }).ok).toBe(false);
  });

  it("rejects the gate after the exception review date", () => {
    expect(evaluateAuditReport(nodeForgeChain(), { now: new Date("2026-10-17T00:00:00Z") }).ok).toBe(false);
  });

  it("ignores MODERATE advisories without creating another exception", () => {
    const report = nodeForgeChain({ moderate: { severity: "moderate", via: [advisory("GHSA-mode-rate-test", "moderate", "moderate")] } });
    expect(evaluateAuditReport(report, { now: beforeReview }).ok).toBe(true);
  });
});
