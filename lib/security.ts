import { createHash } from "node:crypto";

/**
 * Resolution de l'IP client.
 *
 * `x-forwarded-for` est une chaine : l'element LE PLUS A GAUCHE est celui
 * envoye par le client, donc controle par un attaquant. Lire l'index 0
 * permettait de changer de bucket de rate-limit a chaque requete en envoyant
 * son propre header. On privilegie `x-real-ip` (pose par le proxy de bord) et
 * sinon on prend l'element LE PLUS A DROITE, ajoute par le proxy de confiance.
 */
export function requestIp(req: Request): string {
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const chain = req.headers.get("x-forwarded-for");
  if (chain) {
    const parts = chain.split(",").map((part) => part.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return "unknown";
}

export function hashRateKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function configuredOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_APP_URL;
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/**
 * Defense CSRF. Echoue FERME : une requete mutante sans header `Origin` est
 * rejetee. Tous les navigateurs envoient `Origin` sur fetch/XHR et sur les
 * POST de formulaire cross-site, le trafic legitime n'est donc pas impacte.
 */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) {
    // Une navigation same-origin peut omettre Origin ; Sec-Fetch-Site tranche.
    return req.headers.get("sec-fetch-site") === "same-origin";
  }
  try {
    const originUrl = new URL(origin);
    const configured = configuredOrigin();
    if (configured && originUrl.origin === configured) return true;
    const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
    if (!host || originUrl.host !== host) return false;
    const proto = req.headers.get("x-forwarded-proto");
    return !proto || originUrl.protocol === `${proto}:`;
  } catch {
    return false;
  }
}

export function requireSameOrigin(req: Request): { ok: true } | { ok: false; error: string; status: number } {
  return isSameOrigin(req) ? { ok: true } : { ok: false, error: "INVALID_ORIGIN", status: 403 };
}

export function rejectCrossOrigin(req: Request): Response | null {
  return isSameOrigin(req) ? null : Response.json({ error: "INVALID_ORIGIN" }, { status: 403 });
}

/** Headers pour toute reponse transportant des donnees personnelles. */
export const PRIVATE_HEADERS = { "cache-control": "no-store" } as const;
