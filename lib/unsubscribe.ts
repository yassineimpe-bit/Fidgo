import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

/**
 * Lien de désabonnement sans état : identifiant du client + HMAC d'une clé
 * dérivée d'AUTH_SECRET. Il ne permet qu'une chose, retirer le consentement
 * de ce client chez ce commerce ; il n'ouvre ni la carte ni aucune donnée.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function key(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required");
  return Buffer.from(hkdfSync("sha256", secret, "retiko-unsubscribe", "marketing-v1", 32));
}

function signature(customerId: string): Buffer {
  return createHmac("sha256", key()).update(customerId).digest().subarray(0, 18);
}

export function unsubscribeToken(customerId: string): string {
  if (!UUID.test(customerId)) throw new Error("INVALID_CUSTOMER_ID");
  return `${Buffer.from(customerId.replaceAll("-", ""), "hex").toString("base64url")}.${signature(customerId).toString("base64url")}`;
}

/** Identifiant du client si le jeton est authentique, sinon null. */
export function verifyUnsubscribeToken(token: unknown): string | null {
  if (typeof token !== "string" || token.length > 64) return null;
  const [idPart, sigPart] = token.split(".");
  if (!idPart || !sigPart) return null;
  const raw = Buffer.from(idPart, "base64url");
  if (raw.length !== 16) return null;
  const hex = raw.toString("hex");
  const customerId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const given = Buffer.from(sigPart, "base64url");
  const expected = signature(customerId);
  return given.length === expected.length && timingSafeEqual(given, expected) ? customerId : null;
}

export function unsubscribePath(customerId: string): string {
  return `/unsubscribe/${unsubscribeToken(customerId)}`;
}
