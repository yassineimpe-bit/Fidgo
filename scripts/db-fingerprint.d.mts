export type Fingerprint = {
  rows: Record<string, string>;
  aggregates: Record<string, unknown>;
};

export type RestoreVerdict = {
  status: "match" | "mismatch" | "inconclusive";
  differences: string[];
};

export function readFingerprint(sql: unknown): Promise<Fingerprint>;
export function diffFingerprints(expected: Fingerprint, actual: Fingerprint): string[];
export function restoreVerdict(before: Fingerprint, after: Fingerprint, restored: Fingerprint): RestoreVerdict;
