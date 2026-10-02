import { describe, expect, it } from "vitest";
import { evaluateAuditReport } from "../scripts/audit-dependencies.mjs";
import { advisory, allowedNodeForge, auditReport } from "./fixtures/npm-audit";

const beforeReview = new Date("2026-10-16T12:00:00Z");

function nodeForgeChain(extra: Record<string, { severity: "moderate" | "high" | "critical"; via: Array<string | ReturnType<typeof advisory>> }> = {}) {
  return auditReport({
    "node-forge": { severity: "high", via: [allowedNodeForge] },
    "passkit-generator": { severity: "high", via: ["node-forge"] },
    ...extra,
  });
}

describe("targeted npm audit gate", () => {
  it("accepts a report with no HIGH or CRITICAL advisory", () => {
    const report = auditReport({ moderate: { severity: "moderate", via: [advisory("GHSA-mode-rate-test", "moderate", "moderate")] } });
    expect(evaluateAuditReport(report, { now: beforeReview }).ok).toBe(true);
  });

  it("accepts only the named node-forge HIGH advisory before review expiry", () => {
    expect(evaluateAuditReport(nodeForgeChain(), { now: beforeReview })).toMatchObject({ ok: true, failures: [] });
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
