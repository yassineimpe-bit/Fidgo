import {
  buildScanMetricsExport,
  sanitizeScanMetric,
  type ScanMetric,
  type ScanMetricsExport,
} from "@/lib/pilot-field-report.mjs";
import type { ScannerDevice } from "@/lib/pilot-gate.mjs";

export const SCAN_METRICS_STORAGE_KEY = "loyalty_scan_metrics";
// Une série de 15 scans produit environ 30 mesures (lookup + action). 200
// laisse de la marge pour les échecs et relances sans évincer la série ; la
// limite est exportée pour que le rapport détecte une éviction éventuelle.
export const SCAN_METRICS_STORAGE_LIMIT = 200;

type MetricsStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Mesure écrite par le scanner : l'origine QR / saisie manuelle est toujours connue. */
export type RecordedScanMetric = Omit<ScanMetric, "source"> & { source: "qr" | "manual" };

export function readStoredScanMetrics(storage: MetricsStorage): unknown[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(SCAN_METRICS_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function appendScanMetric(storage: MetricsStorage, metric: RecordedScanMetric) {
  const next = [...readStoredScanMetrics(storage), metric];
  storage.setItem(SCAN_METRICS_STORAGE_KEY, JSON.stringify(next.slice(-SCAN_METRICS_STORAGE_LIMIT)));
}

export function clearScanMetrics(storage: MetricsStorage) {
  storage.removeItem(SCAN_METRICS_STORAGE_KEY);
}

/** Mesures lisibles pour l'affichage, et nombre brut d'entrées stockées. */
export function loadScanMetrics(storage: MetricsStorage): { metrics: ScanMetric[]; storedCount: number } {
  const entries = readStoredScanMetrics(storage);
  const metrics = entries.map(sanitizeScanMetric).filter((metric): metric is ScanMetric => metric !== null);
  return { metrics, storedCount: entries.length };
}

export function createScanMetricsExport(storage: MetricsStorage, device: ScannerDevice, now = new Date()): ScanMetricsExport {
  return buildScanMetricsExport(readStoredScanMetrics(storage), {
    device,
    exportedAt: now.toISOString(),
    storageLimit: SCAN_METRICS_STORAGE_LIMIT,
  });
}

/** Nom attendu par `npm run pilot:field-report -- --iphone iphone.json --android android.json`. */
export function scanMetricsExportFilename(device: ScannerDevice) {
  return `${device}.json`;
}

/**
 * Présélection du libellé à partir du seul type d'OS : rien n'est conservé ni
 * exporté hormis le libellé, que le testeur confirme ou corrige.
 */
export function suggestScannerDevice(userAgent: string): ScannerDevice | null {
  if (/android/i.test(userAgent)) return "android";
  if (/iphone|ipod/i.test(userAgent)) return "iphone";
  return null;
}
