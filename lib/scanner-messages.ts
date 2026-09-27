export type ScannerErrorInfo = {
  code: string;
  message: string;
  retryable: boolean;
  network: boolean;
  sessionExpired: boolean;
};

const CODE_MESSAGES: Record<string, Omit<ScannerErrorInfo, "code">> = {
  OFFLINE: {
    message: "Connexion internet absente. Aucune action n’a été envoyée.",
    retryable: true,
    network: true,
    sessionExpired: false,
  },
  NETWORK_ERROR: {
    message: "Connexion perdue : l’action n’a pas été confirmée. Réessaie : Retiko réutilise la même clé, sans risque de double crédit.",
    retryable: true,
    network: true,
    sessionExpired: false,
  },
  UNAUTHORIZED: {
    message: "Session expirée. Reconnecte-toi pour continuer à scanner.",
    retryable: false,
    network: false,
    sessionExpired: true,
  },
  FORBIDDEN: {
    message: "Ce compte n’a pas l’autorisation d’utiliser le scanner.",
    retryable: false,
    network: false,
    sessionExpired: false,
  },
  TOO_MANY_ATTEMPTS: {
    message: "Trop de tentatives en peu de temps. Attends quelques secondes puis réessaie.",
    retryable: true,
    network: false,
    sessionExpired: false,
  },
  // enforceRateLimit() (lib/rate-limit.ts) renvoie ce code sur scan/lookup/
  // credit/redeem : sans entrée dédiée il tombait sur le message technique
  // générique au lieu d'annoncer clairement la limite de fréquence.
  RATE_LIMITED: {
    message: "Trop de tentatives. Réessayez dans quelques instants.",
    retryable: true,
    network: false,
    sessionExpired: false,
  },
  INVALID_QR: {
    message: "Ce QR code n’est pas une carte Retiko valide.",
    retryable: false,
    network: false,
    sessionExpired: false,
  },
  INVALID_QUERY: {
    message: "Saisis un code court ou un email valide.",
    retryable: false,
    network: false,
    sessionExpired: false,
  },
  INVALID_INPUT: {
    message: "Les données envoyées sont invalides. Recharge la carte puis réessaie.",
    retryable: false,
    network: false,
    sessionExpired: false,
  },
  INVALID_AMOUNT: {
    message: "Le montant d’achat est invalide.",
    retryable: false,
    network: false,
    sessionExpired: false,
  },
  CARD_NOT_FOUND: {
    message: "Carte introuvable pour ce commerce.",
    retryable: false,
    network: false,
    sessionExpired: false,
  },
  NOT_FOUND: {
    message: "Aucune carte correspondante n’a été trouvée.",
    retryable: false,
    network: false,
    sessionExpired: false,
  },
  CARD_EXPIRED: {
    message: "Cette carte fidélité a expiré.",
    retryable: false,
    network: false,
    sessionExpired: false,
  },
  COOLDOWN: {
    message: "Passage trop rapproché. Attends quelques secondes puis réessaie.",
    retryable: true,
    network: false,
    sessionExpired: false,
  },
  DAILY_LIMIT: {
    message: "La limite quotidienne de gains de cette carte est atteinte.",
    retryable: false,
    network: false,
    sessionExpired: false,
  },
  STALE_CARD_STATE: {
    message: "La carte a changé sur un autre appareil. Recharge-la avant de confirmer l’override.",
    retryable: false,
    network: false,
    sessionExpired: false,
  },
  // Seul /api/redeem renvoie ce code : le solde a été consommé ailleurs entre
  // l'affichage de la confirmation et le clic final (le serveur fait foi).
  INSUFFICIENT_BALANCE: {
    message: "Le solde a changé. Cette récompense n’est plus disponible. Rescanne la carte pour afficher le solde à jour.",
    retryable: false,
    network: false,
    sessionExpired: false,
  },
};

function looksLikeNetworkFailure(value: string) {
  const normalized = value.toLowerCase();
  return normalized.includes("failed to fetch")
    || normalized.includes("load failed")
    || normalized.includes("networkerror")
    || normalized.includes("network request failed")
    || normalized.includes("fetch failed");
}

export function scannerErrorInfo(error: unknown): ScannerErrorInfo {
  const raw = error instanceof Error ? error.message : String(error || "ERROR");
  const code = raw.trim().toUpperCase() || "ERROR";

  if (looksLikeNetworkFailure(raw)) {
    return { code: "NETWORK_ERROR", ...CODE_MESSAGES.NETWORK_ERROR };
  }

  const known = CODE_MESSAGES[code];
  if (known) return { code, ...known };

  return {
    code,
    message: "Erreur technique. Réessaie ou recharge le scanner si le problème persiste.",
    retryable: true,
    network: false,
    sessionExpired: false,
  };
}

/**
 * Variante d'un message pour une utilisation de récompense : le texte
 * générique parle d'un crédit, ce qui serait faux pour un redeem.
 */
export function scannerActionErrorInfo(error: unknown, kind: "credit" | "redeem"): ScannerErrorInfo {
  const info = scannerErrorInfo(error);
  if (kind !== "redeem") return info;
  if (info.code === "OFFLINE") {
    return { ...info, message: "Connexion internet nécessaire : la récompense n’a pas été utilisée. Reprends l’opération quand le réseau revient." };
  }
  if (info.code === "NETWORK_ERROR") {
    return { ...info, message: "Connexion perdue : l’utilisation de la récompense n’a pas été confirmée. Réessaie : Retiko réutilise la même opération, sans risque de double utilisation." };
  }
  return info;
}
