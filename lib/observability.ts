const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPAQUE_SEGMENT = /^[A-Za-z0-9_-]{24,}$/;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const CARD_TOKEN = /\bLOY1:[A-Za-z0-9_-]{20,64}\b/g;
const SECRET = /\b(?:re_|Bearer\s+)[A-Za-z0-9._-]{12,}\b/gi;
const SENSITIVE_LINK = /https?:\/\/[^\s]+\/(?:c|recover)\/[A-Za-z0-9_-]{20,}/gi;

/**
 * Réduit une URL/route à une forme exploitable dans les logs sans y laisser
 * des identifiants de carte, liens magiques, UUID client ou autres segments
 * opaques. Les query strings et fragments ne sont jamais journalisés.
 */
export function redactSensitivePath(input: unknown): string {
  const raw = typeof input === "string" && input.trim() ? input.trim() : "/";
  const pathname = raw.split(/[?#]/, 1)[0] || "/";

  return pathname
    .split("/")
    .map((segment) => {
      if (!segment) return segment;
      if (UUID_SEGMENT.test(segment)) return "[id]";
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
