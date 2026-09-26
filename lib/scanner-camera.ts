import { parseCardToken } from "@/lib/loyalty";

export type CameraIssue =
  | "denied"
  | "no-camera"
  | "occupied"
  | "unsupported"
  | "insecure"
  | "decoder-failed"
  | "start-failed";

export type CameraIssueInfo = {
  title: string;
  detail: string;
  telemetryCode: string;
  retryable: boolean;
};

export const CAMERA_ISSUE_INFO: Record<CameraIssue, CameraIssueInfo> = {
  denied: {
    title: "Autorisation caméra refusée",
    detail: "Autorise la caméra pour Retiko dans les réglages du site ou de Safari, puis touche Réessayer.",
    telemetryCode: "CAMERA_PERMISSION_DENIED",
    retryable: true,
  },
  "no-camera": {
    title: "Aucune caméra disponible",
    detail: "Aucune caméra utilisable n’a été trouvée sur cet appareil. Utilise la saisie du code ci-dessous.",
    telemetryCode: "CAMERA_NOT_FOUND",
    retryable: false,
  },
  occupied: {
    title: "Caméra déjà utilisée",
    detail: "Ferme l’autre application qui utilise la caméra, puis touche Réessayer.",
    telemetryCode: "CAMERA_IN_USE",
    retryable: true,
  },
  unsupported: {
    title: "Caméra non prise en charge",
    detail: "Ce navigateur ne fournit pas l’API caméra nécessaire. Ouvre Retiko dans Safari ou Chrome, ou saisis le code.",
    telemetryCode: "CAMERA_API_UNSUPPORTED",
    retryable: false,
  },
  insecure: {
    title: "Connexion non sécurisée",
    detail: "La caméra exige HTTPS. Ouvre Retiko depuis son adresse https:// habituelle.",
    telemetryCode: "CAMERA_INSECURE_CONTEXT",
    retryable: false,
  },
  "decoder-failed": {
    title: "Scanner QR indisponible",
    detail: "Le décodeur QR n’a pas pu démarrer. Réessaie, ou utilise la saisie du code ci-dessous.",
    telemetryCode: "QR_DECODER_FAILED",
    retryable: true,
  },
  "start-failed": {
    title: "Échec du démarrage caméra",
    detail: "La caméra n’a pas pu démarrer. Réessaie, ou utilise la saisie du code ci-dessous.",
    telemetryCode: "CAMERA_START_FAILED",
    retryable: true,
  },
};

function errorName(error: unknown): string {
  if (error && typeof error === "object" && "name" in error) {
    return String((error as { name?: unknown }).name || "");
  }
  return "";
}

/**
 * Classe les rejets getUserMedia sans dépendre de DOMException, afin que la
 * logique reste testable et couvre aussi les anciens noms WebKit/Chromium.
 */
export function classifyCameraError(
  error: unknown,
  context: { secureContext: boolean; mediaDevicesAvailable: boolean },
): CameraIssue {
  if (!context.secureContext) return "insecure";
  if (!context.mediaDevicesAvailable) return "unsupported";

  switch (errorName(error)) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "denied";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "no-camera";
    case "NotReadableError":
    case "TrackStartError":
      return "occupied";
    default:
      return "start-failed";
  }
}

/** N'accepte qu'un QR Retiko, jamais une URL ou un QR arbitraire. */
export function extractLoyaltyQr(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  if (!value.startsWith("LOY1:")) return null;
  const token = parseCardToken(value);
  return token ? `LOY1:${token}` : null;
}

export function isDuplicateQr(
  previous: { value: string; at: number } | null,
  value: string,
  now: number,
  windowMs = 4_000,
): boolean {
  return previous?.value === value && now - previous.at < windowMs;
}

export function stopMediaStream(stream: MediaStream | null | undefined) {
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
}

export const REAR_CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
};

type TorchCapableTrack = Pick<MediaStreamTrack, "readyState"> & {
  getCapabilities?: () => MediaTrackCapabilities & { torch?: boolean };
};

/**
 * Vrai seulement si le navigateur expose getCapabilities() ET déclare la
 * torche pour cette piste : aucune supposition par user-agent, pas de bouton
 * mort sur un appareil qui ne la pilote pas (Safari iOS notamment).
 */
export function trackSupportsTorch(track: TorchCapableTrack | null | undefined): boolean {
  if (!track || track.readyState !== "live" || typeof track.getCapabilities !== "function") return false;
  try {
    return track.getCapabilities()?.torch === true;
  } catch {
    return false;
  }
}

export const CAMERA_READY_STORAGE_KEY = "retiko.scanner.cameraReadyMs";
const CAMERA_READY_LIMIT = 20;

type CameraReadyStorage = Pick<Storage, "getItem" | "setItem">;

function readCameraReadySamples(storage: CameraReadyStorage): number[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(CAMERA_READY_STORAGE_KEY) || "[]");
    return Array.isArray(parsed)
      ? parsed.filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 60_000)
      : [];
  } catch {
    return [];
  }
}

/** Durée CAMERA_START → CAMERA_READY mesurée sur cet appareil (20 dernières, locale uniquement). */
export function recordCameraReady(storage: CameraReadyStorage, durationMs: number) {
  const bounded = Math.min(60_000, Math.max(0, Math.round(durationMs)));
  try {
    storage.setItem(CAMERA_READY_STORAGE_KEY, JSON.stringify([...readCameraReadySamples(storage), bounded].slice(-CAMERA_READY_LIMIT)));
  } catch {}
}

export function summarizeCameraReady(storage: CameraReadyStorage): { count: number; last: number | null; median: number | null; max: number | null } {
  const samples = readCameraReadySamples(storage);
  if (!samples.length) return { count: 0, last: null, median: null, max: null };
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    count: samples.length,
    last: samples[samples.length - 1],
    median: sorted[Math.ceil(sorted.length / 2) - 1],
    max: sorted[sorted.length - 1],
  };
}
