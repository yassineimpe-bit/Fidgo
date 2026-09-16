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
    message: "Connexion perdue pendant l’action. Réessaie : Retiko réutilise la même clé pour éviter un double crédit.",
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
  INSUFFICIENT_BALANCE: {
    message: "Le solde est insuffisant pour utiliser cette récompense.",
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
