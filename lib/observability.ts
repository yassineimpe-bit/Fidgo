const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPAQUE_SEGMENT = /^[A-Za-z0-9_-]{24,}$/;

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
