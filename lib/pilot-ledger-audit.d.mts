import type { ScanMetricsExport } from "./pilot-field-report.mjs";
import type { ScannerDevice } from "./pilot-gate.mjs";

export type LedgerAuditWindow = {
  devices: ScannerDevice[];
  from: string;
  to: string;
  expected: { earn: number; redeem: number };
  failedActions: number;
};

export type LedgerWindowObservation = {
  earn: number;
  redeem: number;
  adjust: number;
  reversal: number;
  overrides: number;
  cards: number;
};

export type LedgerAuditObservations = {
  windows: LedgerWindowObservation[];
  cards: { total: number; negativeBalances: number; ledgerMismatches: number };
};

export type LedgerAudit = {
  auditVersion: 1;
  generatedAt: string;
  establishment: string;
  marginMinutes: number;
  readOnly: true;
  plan: LedgerAuditWindow[];
  observations: LedgerAuditObservations;
  checks: { id: string; ok: boolean; message: string }[];
  verdict: { status: "CONSISTENT" | "TO_REVIEW"; label: string; reasons: string[] };
};

export declare const LEDGER_AUDIT_DEFAULT_MARGIN_MINUTES: number;
export declare const LEDGER_AUDIT_MAX_MARGIN_MINUTES: number;

export declare function planLedgerAudit(
  exports: Partial<Record<ScannerDevice, ScanMetricsExport>>,
  options?: { marginMinutes?: number },
): LedgerAuditWindow[];
export declare function evaluateLedgerAudit(input: {
  establishment: string;
  plan: LedgerAuditWindow[];
  observations: LedgerAuditObservations;
  generatedAt?: string;
  marginMinutes?: number;
}): LedgerAudit;
export declare function renderLedgerAuditText(audit: LedgerAudit): string;
export declare function renderLedgerAuditMarkdown(audit: LedgerAudit): string;
