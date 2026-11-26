export type AuditGateResult = {
  ok: boolean;
  failures: string[];
  allowed: Array<{ id: string; cve: string; reviewThrough: string }>;
};

export type AuditException = {
  packageName: string;
  severity: "high" | "critical";
  cve: string;
  introducedOn: string;
  reviewThrough: string;
  removeWhen: string;
};

export const ALLOWED_ADVISORIES: ReadonlyMap<string, AuditException>;

export function evaluateAuditReport(
  report: unknown,
  options?: { now?: Date | string; exceptions?: ReadonlyMap<string, AuditException> },
): AuditGateResult;
export function runAudit(options?: { now?: Date | string }): number;
