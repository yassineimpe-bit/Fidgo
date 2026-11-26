export type AuditGateResult = {
  ok: boolean;
  failures: string[];
  allowed: Array<{ id: string; cve: string; reviewThrough: string }>;
};

export function evaluateAuditReport(report: unknown, options?: { now?: Date | string }): AuditGateResult;
export function runAudit(options?: { now?: Date | string }): number;
