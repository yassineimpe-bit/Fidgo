import type {
  PilotThresholdDecision,
  ScannerDevice,
  ThresholdResult,
} from "./pilot-gate.mjs";

export type ScanMetricPhase = "lookup" | "action";
export type ScanMetricAction = "credit" | "redeem";
export type ScanMetricSource = "qr" | "manual" | "unknown";

export type ScanMetric = {
  phase: ScanMetricPhase;
  action?: ScanMetricAction;
  source: ScanMetricSource;
  networkMs: number;
  serverMs: number;
  totalMs: number;
  ok: boolean;
  at: string;
  errorCode?: string;
};

export type ScanMetricsExport = {
  format: "retiko-scan-metrics";
  version: 1;
  exportedAt: string;
  device: ScannerDevice;
  storageLimit: number;
  storedCount: number;
  metrics: ScanMetric[];
};

export type ExportValidation =
  | { ok: true; value: ScanMetricsExport }
  | { ok: false; errors: string[] };

export type DurationSummary = {
  n: number;
  p50: number | null;
  p90: number | null;
  p95: number | null;
  max: number | null;
};

export type ScanMetricGroups = {
  qrActionsOk: ScanMetric[];
  qrActionsFailed: ScanMetric[];
  qrLookupsOk: ScanMetric[];
  qrLookupsFailed: ScanMetric[];
  manual: ScanMetric[];
  unknownSource: ScanMetric[];
};

export type ReportStatus = "GO" | "NO_GO" | "INCOMPLETE" | "NON_COMPLIANT" | "DECISION_REQUIRED";

export type DeviceReport =
  | { device: ScannerDevice; label: string; present: false; file: null }
  | {
    device: ScannerDevice;
    label: string;
    present: true;
    file: string | null;
    exportedAt: string;
    storageLimit: number;
    storedCount: number;
    metricsCount: number;
    discardedCount: number;
    possiblyTruncated: boolean;
    officialActions: number;
    credits: number;
    redeems: number;
    failedActions: number;
    failedLookups: number;
    failureCodes: Record<string, number>;
    manualActions: number;
    manualLookups: number;
    unknownSource: number;
    stats: DurationSummary;
    networkP95: number | null;
    serverP95: number | null;
    lookup: DurationSummary;
    actionWindow: { first: string | null; last: string | null };
  };

export type ReportCheck = { id: string; blocking: boolean; ok: boolean; message: string };

export type PilotFieldReport = {
  reportVersion: 1;
  generatedAt: string;
  criterion: string;
  method: string;
  expected: { actionsPerDevice: number; totalActions: number };
  devices: Record<ScannerDevice, DeviceReport>;
  combined: {
    officialActions: number;
    credits: number;
    redeems: number;
    stats: DurationSummary;
    networkP95: number | null;
    serverP95: number | null;
    lookup: DurationSummary;
    failedActions: number;
    failedLookups: number;
    failureCodes: Record<string, number>;
    manualActions: number;
    manualLookups: number;
    unknownSource: number;
    sorted: { rank: number; device: ScannerDevice; action: ScanMetricAction; totalMs: number; at: string }[];
  };
  thresholds: ThresholdResult[];
  decision: { status: PilotThresholdDecision["status"]; officialThresholdId: PilotThresholdDecision["officialThresholdId"]; summary: string };
  checks: ReportCheck[];
  verdict: { status: ReportStatus; label: string; summary: string; reasons: string[] };
  disclaimer: string;
};

export declare const SCAN_METRICS_EXPORT_FORMAT: "retiko-scan-metrics";
export declare const SCAN_METRICS_EXPORT_VERSION: 1;
export declare const PILOT_FIELD_REPORT_VERSION: 1;
export declare const CLIENT_PROOF_DISCLAIMER: string;

export declare function nearestRankPosition(count: number, percent: number): number;
export declare function nearestRank(values: readonly number[], percent: number): number | null;
export declare function summarizeDurations(values: readonly number[]): DurationSummary;
export declare function normalizeScanErrorCode(code: unknown): string;
export declare function sanitizeScanMetric(raw: unknown): ScanMetric | null;
export declare function buildScanMetricsExport(
  rawEntries: unknown,
  options: { device: ScannerDevice; exportedAt: string; storageLimit: number },
): ScanMetricsExport;
export declare function validateScanMetricsExport(value: unknown, options?: { expectedDevice?: ScannerDevice }): ExportValidation;
export declare function parseScanMetricsExport(text: string, options?: { expectedDevice?: ScannerDevice }): ExportValidation;
export declare function classifyScanMetrics(metrics: readonly ScanMetric[]): ScanMetricGroups;
export declare function formatDurationMs(value: number | null | undefined): string;
export declare function buildPilotFieldReport(input?: {
  exports?: Partial<Record<ScannerDevice, ScanMetricsExport>>;
  files?: Partial<Record<ScannerDevice, string>>;
  generatedAt?: string;
  decision?: PilotThresholdDecision;
}): PilotFieldReport;
export declare function renderPilotFieldReportText(report: PilotFieldReport): string;
export declare function renderPilotFieldReportMarkdown(report: PilotFieldReport): string;
