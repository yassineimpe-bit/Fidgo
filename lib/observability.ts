const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPAQUE_SEGMENT = /^[A-Za-z0-9_-]{24,}$/;
const CARD_CAPABILITY_SEGMENT = /^LOY1:[A-Za-z0-9_-]{20,64}$/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const CARD_TOKEN = /\bLOY1:[A-Za-z0-9_-]{20,64}\b/g;
const SECRET = /\b(?:re_|Bearer\s+)[A-Za-z0-9._-]{12,}\b/gi;
const SENSITIVE_LINK = /https?:\/\/[^\s]+\/(?:c|recover)\/[A-Za-z0-9_-]{20,}/gi;

const SENSITIVE_ROUTE_PREFIXES = [
  ["c"],
  ["recover"],
  ["unsubscribe"],
  ["api", "unsubscribe"],
  ["api", "card"],
  ["api", "wallet", "apple"],
  ["api", "wallet", "google"],
] as const;

function isSensitiveRouteSegment(segments: string[], index: number): boolean {
  const segment = segments[index]?.toLowerCase();
  if (!segment) return false;

  return SENSITIVE_ROUTE_PREFIXES.some((prefix) => {
    if (index !== prefix.length) return false;
    if (!prefix.every((part, prefixIndex) => segments[prefixIndex]?.toLowerCase() === part)) return false;

    // Ces routes statiques ne transportent pas de capability dans leur chemin.
    if (prefix[0] === "api" && prefix[1] === "card" && segment === "status") return false;
    if (prefix[0] === "api" && prefix[1] === "wallet" && prefix[2] === "apple" && segment === "web") return false;
    return true;
  });
}

function deploymentVersion(): string {
  return process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "dev";
}

/**
 * Réduit une URL/route à une forme exploitable dans les logs sans y laisser
 * des identifiants de carte, liens magiques, UUID client ou autres segments
 * opaques. Les query strings et fragments ne sont jamais journalisés.
 */
export function redactSensitivePath(input: unknown): string {
  const raw = typeof input === "string" && input.trim() ? input.trim() : "/";
  const pathname = raw.split(/[?#]/, 1)[0] || "/";

  const segments = pathname.split("/");

  return segments
    .map((segment, index) => {
      if (!segment) return segment;
      if (isSensitiveRouteSegment(segments.slice(1), index - 1)) return "[redacted]";
      if (UUID_SEGMENT.test(segment)) return "[id]";
      if (CARD_CAPABILITY_SEGMENT.test(segment)) return "[redacted]";
      if (OPAQUE_SEGMENT.test(segment)) return "[redacted]";
      return segment;
    })
    .join("/") || "/";
}

/** Nettoie les motifs libres conservés dans le ledger et les audit logs. */
export function sanitizeAuditText(input: unknown, maxLength = 240): string {
  const value = typeof input === "string" ? input : "";
  return value
    .replace(SENSITIVE_LINK, "[sensitive-link]")
    .replace(CARD_TOKEN, "[card-token]")
    .replace(SECRET, "[secret]")
    .replace(EMAIL, "[email]")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

/**
 * Réduit une exception à un code exploitable sans recopier message SQL,
 * réponse fournisseur, email, token ou credential dans les logs.
 */
export function safeErrorCode(error: unknown, fallback: string): string {
  if (typeof error === "object" && error && "code" in error) {
    const code = String((error as { code?: unknown }).code || "");
    // Accepte les SQLSTATE et les codes symboliques habituels, jamais une
    // chaîne opaque en minuscules qui pourrait en réalité être un credential.
    if (/^(?:[0-9A-Z]{5}|[A-Z][A-Z0-9_]{0,63})$/.test(code)) return code;
  }
  const message = error instanceof Error ? error.message : String(error || "");
  const named = message.match(/^([A-Z][A-Z0-9_]*(?:_[0-9]{3})?)(?::|$)/)?.[1];
  if (named) return named.slice(0, 64);
  // FNV-1a suffit ici : il s'agit uniquement de regrouper des erreurs, pas de
  // protéger un secret. Cette implémentation reste compatible Edge/browser.
  let hash = 0x811c9dc5;
  for (let index = 0; index < message.length; index += 1) {
    hash ^= message.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  const fingerprint = (hash >>> 0).toString(16).padStart(8, "0");
  return `${fallback}_${fingerprint}`.slice(0, 80);
}

export function logApiMetric(route: string, status: number, durationMs: number) {
  const payload = {
    route: sanitizeAuditText(route, 80) || "UNKNOWN",
    status,
    durationMs: Math.max(0, Math.round(durationMs)),
    slow: durationMs >= 1500,
    version: deploymentVersion(),
  };

  if (status >= 500) {
    console.error("RETIKO_API_METRIC", payload);
  } else if (payload.slow) {
    console.warn("RETIKO_API_METRIC", payload);
  } else {
    console.info("RETIKO_API_METRIC", payload);
  }
}

export function logHealthSnapshot(input: {
  ok: boolean;
  database: string;
  schema: string;
  auth: string;
  serverMs: number;
}) {
  const payload = {
    ok: input.ok,
    database: sanitizeAuditText(input.database, 32),
    schema: sanitizeAuditText(input.schema, 32),
    auth: sanitizeAuditText(input.auth, 32),
    serverMs: Math.max(0, Math.round(input.serverMs)),
    version: deploymentVersion(),
  };

  if (!input.ok) {
    console.error("RETIKO_HEALTH_DEGRADED", payload);
  } else if (payload.serverMs >= 1000) {
    console.warn("RETIKO_HEALTH_SLOW", payload);
  } else {
    console.info("RETIKO_HEALTH_OK", payload);
  }
}

/**
 * Filet de sécurité pour les routes API : une panne infra (base injoignable,
 * pool épuisé, timeout réseau) survenant avant ou après la logique métier ne
 * doit jamais atteindre le client sous forme de page vide / réponse non-JSON.
 * Les erreurs métier attendues (CARD_NOT_FOUND, COOLDOWN, ...) sont déjà
 * gérées par les catch internes de chaque route et ne remontent pas ici.
 *
 * Chaque route enveloppée émet aussi une métrique structurée (status +
 * durationMs) exploitable directement dans les Runtime Logs Vercel. Les
 * routes sensibles comme SCAN deviennent ainsi observables sans journaliser
 * de token, d'identifiant client ou de contenu métier.
 */
export function withApiErrorHandling<A extends unknown[]>(
  routeName: string,
  handler: (...args: A) => Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    const started = Date.now();
    try {
      const response = await handler(...args);
      logApiMetric(routeName, response.status, Date.now() - started);
      return response;
    } catch (error) {
      console.error(`${routeName}_FAILED`, { code: safeErrorCode(error, `${routeName}_FAILED`) });
      logApiMetric(routeName, 500, Date.now() - started);
      // Header inlined (plutôt qu'importé de lib/security) : ce module est
      // aussi importé côté client (sanitizeAuditText), et lib/security tire
      // node:crypto, ce que le bundle navigateur ne peut pas résoudre.
      return Response.json({ error: "SERVER_ERROR" }, { status: 500, headers: { "cache-control": "no-store" } });
    }
  };
}
