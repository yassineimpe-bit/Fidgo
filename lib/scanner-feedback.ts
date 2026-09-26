import type { ScannerErrorInfo } from "@/lib/scanner-messages";

/**
 * Catégorie visuelle d'un retour du scanner. Chaque catégorie a sa propre
 * icône et son propre titre : l'état reste lisible sans la couleur.
 */
export type ScanFeedbackTone =
  | "success"
  | "reward"
  | "pending"
  | "cooldown"
  | "network"
  | "session"
  | "invalid-qr"
  | "wrong-card"
  | "limit"
  | "refused"
  | "technical"
  | "camera";

export type ScanFeedbackKind = { tone: ScanFeedbackTone; title: string };

const REFUSED_CODES = new Set([
  "FORBIDDEN",
  "INVALID_QUERY",
  "INVALID_INPUT",
  "INVALID_AMOUNT",
  "CARD_EXPIRED",
  "DAILY_LIMIT",
  "STALE_CARD_STATE",
  "INSUFFICIENT_BALANCE",
]);

/** Titre court et catégorie d'une erreur du scanner (le message détaillé reste celui de scannerErrorInfo). */
export function scanErrorFeedback(info: ScannerErrorInfo): ScanFeedbackKind {
  if (info.sessionExpired) return { tone: "session", title: "Session expirée" };
  if (info.code === "OFFLINE") return { tone: "network", title: "Hors ligne" };
  if (info.network) return { tone: "network", title: "Non confirmé" };
  if (info.code === "COOLDOWN") return { tone: "cooldown", title: "Crédit récent détecté" };
  if (info.code === "INVALID_QR") return { tone: "invalid-qr", title: "QR non reconnu" };
  // L'API ne distingue volontairement pas « carte d'un autre commerce » de
  // « carte inconnue » : aucune information ne fuit d'un tenant à l'autre.
  if (info.code === "CARD_NOT_FOUND" || info.code === "NOT_FOUND") return { tone: "wrong-card", title: "Carte inconnue ici" };
  if (info.code === "RATE_LIMITED" || info.code === "TOO_MANY_ATTEMPTS") return { tone: "limit", title: "Patiente un instant" };
  if (REFUSED_CODES.has(info.code)) return { tone: "refused", title: "Refusé" };
  return { tone: "technical", title: "Erreur technique" };
}

/** Au-delà de ce délai sans réponse, le scanner annonce explicitement qu'il attend le serveur. */
export const SLOW_RESPONSE_MS = 1_200;

/** Délai entre la confirmation serveur et le retour automatique à la caméra. */
export const SUCCESS_RESET_MS = 1_250;

export const SCANNER_SOUND_STORAGE_KEY = "retiko.scanner.sound";

type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

/** Le son est désactivé par défaut : il ne s'active que sur choix explicite, par appareil. */
export function readScannerSound(storage: PreferenceStorage | null | undefined): boolean {
  try {
    return storage?.getItem(SCANNER_SOUND_STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

export function writeScannerSound(storage: PreferenceStorage | null | undefined, enabled: boolean) {
  try {
    storage?.setItem(SCANNER_SOUND_STORAGE_KEY, enabled ? "on" : "off");
  } catch {}
}
