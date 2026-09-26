import { describe, expect, it } from "vitest";
import { scannerErrorInfo } from "@/lib/scanner-messages";
import { SCANNER_SOUND_STORAGE_KEY, readScannerSound, scanErrorFeedback, writeScannerSound } from "@/lib/scanner-feedback";
import { CAMERA_READY_STORAGE_KEY, recordCameraReady, summarizeCameraReady, trackSupportsTorch } from "@/lib/scanner-camera";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    data,
  };
}

describe("scanner : catégorie de chaque retour", () => {
  it("donne à chaque état un titre et une icône distincts", () => {
    const tone = (code: string) => scanErrorFeedback(scannerErrorInfo(new Error(code)));
    expect(tone("UNAUTHORIZED")).toEqual({ tone: "session", title: "Session expirée" });
    expect(tone("OFFLINE")).toEqual({ tone: "network", title: "Hors ligne" });
    expect(scanErrorFeedback(scannerErrorInfo(new TypeError("Failed to fetch")))).toEqual({ tone: "network", title: "Non confirmé" });
    expect(tone("COOLDOWN")).toEqual({ tone: "cooldown", title: "Crédit récent détecté" });
    expect(tone("INVALID_QR")).toEqual({ tone: "invalid-qr", title: "QR non reconnu" });
    expect(tone("CARD_NOT_FOUND")).toEqual({ tone: "wrong-card", title: "Carte inconnue ici" });
    expect(tone("NOT_FOUND")).toEqual({ tone: "wrong-card", title: "Carte inconnue ici" });
    expect(tone("RATE_LIMITED")).toEqual({ tone: "limit", title: "Patiente un instant" });
    expect(tone("DAILY_LIMIT")).toEqual({ tone: "refused", title: "Refusé" });
    expect(tone("FORBIDDEN")).toEqual({ tone: "refused", title: "Refusé" });
    expect(tone("SOME_INTERNAL_FAILURE")).toEqual({ tone: "technical", title: "Erreur technique" });
  });

  it("une coupure réseau dit que l'action n'a pas été confirmée", () => {
    expect(scannerErrorInfo(new TypeError("Load failed")).message).toContain("n’a pas été confirmée");
  });
});

describe("scanner : son", () => {
  it("coupé par défaut, activé seulement sur choix explicite", () => {
    const storage = memoryStorage();
    expect(readScannerSound(storage)).toBe(false);
    expect(readScannerSound(null)).toBe(false);
    writeScannerSound(storage, true);
    expect(storage.data.get(SCANNER_SOUND_STORAGE_KEY)).toBe("on");
    expect(readScannerSound(storage)).toBe(true);
    writeScannerSound(storage, false);
    expect(readScannerSound(storage)).toBe(false);
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readScannerSound(throwing)).toBe(false);
    expect(() => writeScannerSound(throwing, true)).not.toThrow();
  });
});

describe("scanner : torche", () => {
  it("n'est proposée que si la piste la déclare réellement", () => {
    expect(trackSupportsTorch(null)).toBe(false);
    expect(trackSupportsTorch({ readyState: "live" })).toBe(false);
    expect(trackSupportsTorch({ readyState: "live", getCapabilities: () => ({}) })).toBe(false);
    expect(trackSupportsTorch({ readyState: "live", getCapabilities: () => ({ torch: false }) })).toBe(false);
    expect(trackSupportsTorch({ readyState: "ended", getCapabilities: () => ({ torch: true }) })).toBe(false);
    expect(trackSupportsTorch({ readyState: "live", getCapabilities: () => { throw new Error("nope"); } })).toBe(false);
    expect(trackSupportsTorch({ readyState: "live", getCapabilities: () => ({ torch: true }) })).toBe(true);
  });
});

describe("scanner : ouverture caméra", () => {
  it("garde les 20 dernières durées bornées et résume dernière, médiane, max", () => {
    const storage = memoryStorage();
    expect(summarizeCameraReady(storage)).toEqual({ count: 0, last: null, median: null, max: null });
    for (const ms of [800, 300, 500]) recordCameraReady(storage, ms);
    expect(summarizeCameraReady(storage)).toEqual({ count: 3, last: 500, median: 500, max: 800 });
    for (let i = 0; i < 30; i += 1) recordCameraReady(storage, 100_000);
    const summary = summarizeCameraReady(storage);
    expect(summary.count).toBe(20);
    expect(summary.max).toBe(60_000);
    const corrupted = memoryStorage({ [CAMERA_READY_STORAGE_KEY]: "not json" });
    expect(summarizeCameraReady(corrupted).count).toBe(0);
  });
});
