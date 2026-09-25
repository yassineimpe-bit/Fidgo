import { describe, expect, it } from "vitest";
import { validateScanMetricsExport } from "@/lib/pilot-field-report.mjs";
import {
  SCAN_METRICS_STORAGE_KEY,
  SCAN_METRICS_STORAGE_LIMIT,
  appendScanMetric,
  clearScanMetrics,
  createScanMetricsExport,
  loadScanMetrics,
  readStoredScanMetrics,
  scanMetricsExportFilename,
  suggestScannerDevice,
  type RecordedScanMetric,
} from "@/lib/scan-metrics";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    raw: (key: string) => values.get(key),
  };
}

function metric(index: number): RecordedScanMetric {
  return {
    phase: "action",
    action: "credit",
    source: "qr",
    networkMs: 100,
    serverMs: 20,
    totalMs: 1_000 + index,
    ok: true,
    at: new Date(Date.UTC(2026, 8, 30, 10, 0, index)).toISOString(),
  };
}

describe("mesures scanner locales", () => {
  it("garde les 200 dernières mesures, assez pour une série de 15 scans avec relances", () => {
    expect(SCAN_METRICS_STORAGE_LIMIT).toBe(200);
    const storage = memoryStorage();
    for (let index = 0; index < 205; index += 1) appendScanMetric(storage, metric(index));
    const stored = readStoredScanMetrics(storage) as RecordedScanMetric[];
    expect(stored).toHaveLength(200);
    expect(stored[0].totalMs).toBe(1_005);
    expect(stored[199].totalMs).toBe(1_204);
  });

  it("repart d'une liste vide si le stockage est corrompu", () => {
    for (const corrupted of ["{", '{"a":1}', "42", "null"]) {
      const storage = memoryStorage({ [SCAN_METRICS_STORAGE_KEY]: corrupted });
      expect(readStoredScanMetrics(storage)).toEqual([]);
      appendScanMetric(storage, metric(1));
      expect(readStoredScanMetrics(storage)).toHaveLength(1);
    }
  });

  it("lit les anciennes mesures sans origine comme « unknown » et compte les entrées brutes", () => {
    const legacy = { phase: "action", action: "credit", networkMs: 1, serverMs: 1, totalMs: 900, ok: true, at: "2026-09-20T10:00:00.000Z" };
    const storage = memoryStorage({ [SCAN_METRICS_STORAGE_KEY]: JSON.stringify([legacy, metric(1), { broken: true }]) });
    const loaded = loadScanMetrics(storage);
    expect(loaded.storedCount).toBe(3);
    expect(loaded.metrics.map((entry) => entry.source)).toEqual(["unknown", "qr"]);
  });

  it("exporte au format v1 validé par le rapport, sans champ hors liste blanche", () => {
    const storage = memoryStorage();
    appendScanMetric(storage, metric(1));
    appendScanMetric(storage, { ...metric(2), ok: false, errorCode: "COOLDOWN" });
    const polluted = [...readStoredScanMetrics(storage), { ...metric(3), email: "client@example.com", token: "LOY1:abcdefghijklmnopqrstuvwxyz" }];
    storage.setItem(SCAN_METRICS_STORAGE_KEY, JSON.stringify(polluted));

    const exported = createScanMetricsExport(storage, "android", new Date("2026-09-30T11:00:00.000Z"));
    expect(exported).toMatchObject({ format: "retiko-scan-metrics", version: 1, device: "android", exportedAt: "2026-09-30T11:00:00.000Z", storageLimit: 200, storedCount: 3 });
    expect(JSON.stringify(exported)).not.toMatch(/email|token|LOY1|example\.com/);
    expect(exported.metrics[1]).toMatchObject({ ok: false, errorCode: "COOLDOWN" });
    expect(validateScanMetricsExport(exported, { expectedDevice: "android" }).ok).toBe(true);
    expect(scanMetricsExportFilename("android")).toBe("android.json");
    expect(scanMetricsExportFilename("iphone")).toBe("iphone.json");
  });

  it("efface la clé locale", () => {
    const storage = memoryStorage();
    appendScanMetric(storage, metric(1));
    clearScanMetrics(storage);
    expect(storage.raw(SCAN_METRICS_STORAGE_KEY)).toBeUndefined();
    expect(loadScanMetrics(storage)).toEqual({ metrics: [], storedCount: 0 });
  });

  it("présélectionne l'appareil depuis le seul type d'OS", () => {
    expect(suggestScannerDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1")).toBe("iphone");
    expect(suggestScannerDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/140.0 Mobile/15E148 Safari/604.1")).toBe("iphone");
    expect(suggestScannerDevice("Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36")).toBe("android");
    expect(suggestScannerDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15")).toBeNull();
    expect(suggestScannerDevice("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)")).toBeNull();
    expect(suggestScannerDevice("")).toBeNull();
  });
});
