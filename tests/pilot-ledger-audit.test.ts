import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildScanMetricsExport, type ScanMetricsExport } from "@/lib/pilot-field-report.mjs";
import type { ScannerDevice } from "@/lib/pilot-gate.mjs";
import {
  evaluateLedgerAudit,
  planLedgerAudit,
  renderLedgerAuditMarkdown,
  renderLedgerAuditText,
  type LedgerWindowObservation,
} from "@/lib/pilot-ledger-audit.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function minute(value: number) {
  return new Date(Date.UTC(2026, 8, 30, 10, value)).toISOString();
}

function exportOf(device: ScannerDevice, actions: { minute: number; ok?: boolean; action?: "credit" | "redeem"; source?: string }[]): ScanMetricsExport {
  const metrics = actions.flatMap((entry) => [
    { phase: "lookup", source: entry.source ?? "qr", networkMs: 100, serverMs: 20, totalMs: 300, ok: true, at: minute(entry.minute) },
    { phase: "action", action: entry.action ?? "credit", source: entry.source ?? "qr", networkMs: 100, serverMs: 20, totalMs: 1_000, ok: entry.ok ?? true, at: minute(entry.minute) },
  ]);
  return buildScanMetricsExport(metrics, { device, exportedAt: minute(200), storageLimit: 200 });
}

function seen(overrides: Partial<LedgerWindowObservation> = {}): LedgerWindowObservation {
  return { earn: 0, redeem: 0, adjust: 0, reversal: 0, overrides: 0, cards: 1, ...overrides };
}

const cleanCards = { total: 2, negativeBalances: 0, ledgerMismatches: 0 };

describe("rapprochement ledger du gate terrain", () => {
  it("attend une transaction par action réussie, par fenêtre de série", () => {
    const plan = planLedgerAudit({
      iphone: exportOf("iphone", [{ minute: 0 }, { minute: 3 }, { minute: 6, ok: false }]),
      android: exportOf("android", [{ minute: 30 }, { minute: 33, action: "redeem" }, { minute: 36, source: "manual" }]),
    });
    expect(plan).toEqual([
      { devices: ["iphone"], from: minute(-1), to: minute(7), expected: { earn: 2, redeem: 0 }, failedActions: 1 },
      { devices: ["android"], from: minute(29), to: minute(37), expected: { earn: 2, redeem: 1 }, failedActions: 0 },
    ]);
  });

  it("fusionne des séries qui se chevauchent et ignore un appareil sans action", () => {
    const plan = planLedgerAudit({
      iphone: exportOf("iphone", [{ minute: 0 }, { minute: 10 }]),
      android: exportOf("android", [{ minute: 5 }]),
    }, { marginMinutes: 0 });
    expect(plan).toEqual([{ devices: ["iphone", "android"], from: minute(0), to: minute(10), expected: { earn: 3, redeem: 0 }, failedActions: 0 }]);
    expect(planLedgerAudit({ iphone: exportOf("iphone", []) })).toEqual([]);
    expect(() => planLedgerAudit({}, { marginMinutes: -1 })).toThrow(RangeError);
    expect(() => planLedgerAudit({}, { marginMinutes: 61 })).toThrow(RangeError);
  });

  it("conclut COHÉRENT seulement si téléphones et ledger concordent exactement", () => {
    const plan = planLedgerAudit({ iphone: exportOf("iphone", [{ minute: 0 }, { minute: 3 }]) });
    const consistent = evaluateLedgerAudit({ establishment: "commerce-test", plan, observations: { windows: [seen({ earn: 2 })], cards: cleanCards } });
    expect(consistent.verdict).toMatchObject({ status: "CONSISTENT", label: "COHÉRENT", reasons: [] });
    expect(renderLedgerAuditText(consistent)).toContain("RAPPROCHEMENT : COHÉRENT");
    expect(renderLedgerAuditMarkdown(consistent)).toContain("BEGIN READ ONLY");

    const cases: [Partial<LedgerWindowObservation>, typeof cleanCards, RegExp][] = [
      [{ earn: 3 }, cleanCards, /3 crédit\(s\) en base pour 2 .*écriture en trop/],
      [{ earn: 1 }, cleanCards, /1 crédit\(s\) en base pour 2 .*action réussie sans transaction/],
      [{ earn: 2, redeem: 1 }, cleanCards, /1 utilisation\(s\) de récompense en base pour 0/],
      [{ earn: 2, adjust: 1 }, cleanCards, /1 ajustement\(s\)/],
      [{ earn: 2, reversal: 1 }, cleanCards, /1 annulation\(s\)/],
      [{ earn: 2, overrides: 1 }, cleanCards, /1 override\(s\) de cooldown/],
      [{ earn: 2 }, { total: 2, negativeBalances: 0, ledgerMismatches: 1 }, /1 écart\(s\) ledger\/solde/],
      [{ earn: 2 }, { total: 2, negativeBalances: 1, ledgerMismatches: 0 }, /1 solde\(s\) négatif\(s\)/],
    ];
    for (const [observation, cards, reason] of cases) {
      const audit = evaluateLedgerAudit({ establishment: "commerce-test", plan, observations: { windows: [seen(observation)], cards } });
      expect(audit.verdict.status).toBe("TO_REVIEW");
      expect(audit.verdict.reasons.join("\n")).toMatch(reason);
      expect(renderLedgerAuditText(audit)).toContain("RAPPROCHEMENT : À ANALYSER");
    }
  });

  it("le script ne peut qu'observer : SELECT en BEGIN READ ONLY, DATABASE_URL par l'environnement", () => {
    const source = readFileSync(path.join(repoRoot, "scripts", "pilot-ledger-audit.mjs"), "utf8");
    expect(source).toContain('sql.begin("read only"');
    expect(source).toContain("show transaction_read_only");
    expect(source).toContain("set local statement_timeout");
    expect(source).not.toMatch(/\b(insert\s+into|update\s+\w+\s+set|delete\s+from|truncate|alter\s+table|drop\s+|create\s+|grant\s+|sql\.unsafe)\b/i);
    expect(source).not.toMatch(/postgres(ql)?:\/\//);
    expect(source.match(/DATABASE_URL/g)?.length).toBeGreaterThan(0);
    expect(source).toContain("process.env.DATABASE_URL");
  });

  it("refuse de s'exécuter sans DATABASE_URL, sans slug ou sans action à rapprocher (code 2)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pilot-ledger-audit-"));
    try {
      const iphone = path.join(dir, "iphone.json");
      writeFileSync(iphone, JSON.stringify(exportOf("iphone", [{ minute: 0 }])));
      const empty = path.join(dir, "empty.json");
      writeFileSync(empty, JSON.stringify(exportOf("iphone", [])));
      const env = { ...process.env };
      delete env.DATABASE_URL;
      const run = (...args: string[]) => spawnSync(process.execPath, [path.join(repoRoot, "scripts", "pilot-ledger-audit.mjs"), ...args], { cwd: dir, env, encoding: "utf8" });

      const noUrl = run("--establishment", "commerce-test", "--iphone", iphone);
      expect(noUrl.status).toBe(2);
      expect(noUrl.stderr).toContain("DATABASE_URL requis dans l'environnement");
      expect(run("--iphone", iphone).status).toBe(2);
      expect(run("--establishment", "Commerce Test", "--iphone", iphone).status).toBe(2);
      expect(run("--establishment", "commerce-test", "--iphone", iphone, "--margin-minutes", "-3").status).toBe(2);
      expect(run("--establishment", "commerce-test", "--iphone", empty).stderr).toContain("rien à rapprocher");
      expect(run("--establishment", "commerce-test", "--iphone", iphone, "--json-output", iphone).status).toBe(2);
      expect(run("--help").status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
