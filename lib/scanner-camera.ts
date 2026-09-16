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
