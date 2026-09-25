export type ScannerDevice = "iphone" | "android";
export type ThresholdComparator = "lt" | "lte";
export type ThresholdRole = "target" | "candidate";
export type P95GateStatus = "GO" | "NO_GO" | "DECISION_REQUIRED";

export type PilotP95Threshold = {
  readonly id: "internal" | "strict" | "historical";
  readonly label: string;
  readonly limitMs: number;
  readonly comparator: ThresholdComparator;
  readonly role: ThresholdRole;
  readonly source: string;
};

export type PilotThresholdDecision = {
  readonly status: "pending" | "decided";
  readonly officialThresholdId: "strict" | "historical" | null;
  readonly summary: string;
};

export type ThresholdResult = {
  id: PilotP95Threshold["id"];
  label: string;
  limitMs: number;
  comparator: ThresholdComparator;
  role: ThresholdRole;
  source: string;
  rule: string;
  pass: boolean;
};

export declare const HISTORICAL_PILOT_THRESHOLD_MS: 2500;
export declare const STRICT_PILOT_THRESHOLD_MS: 2000;
export declare const INTERNAL_TARGET_MS: 1500;
export declare const PILOT_P95_THRESHOLDS: readonly PilotP95Threshold[];
export declare const PILOT_THRESHOLD_DECISION: PilotThresholdDecision;
export declare const PILOT_GATE: {
  readonly devices: readonly ScannerDevice[];
  readonly deviceLabels: Readonly<Record<ScannerDevice, string>>;
  readonly actionsPerDevice: number;
  readonly totalActions: number;
  readonly criterion: string;
};

export declare function describeThresholdRule(threshold: PilotP95Threshold): string;
export declare function passesThreshold(valueMs: number | null, threshold: PilotP95Threshold): boolean;
export declare function evaluateP95Thresholds(
  p95Ms: number | null,
  thresholds?: readonly PilotP95Threshold[],
): ThresholdResult[];
export declare function p95GateStatus(
  p95Ms: number,
  decision?: PilotThresholdDecision,
  thresholds?: readonly PilotP95Threshold[],
): P95GateStatus;
