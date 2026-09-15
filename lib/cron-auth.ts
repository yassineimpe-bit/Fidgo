import { createHash, timingSafeEqual } from "node:crypto";

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

export function isAuthorizedCronRequest(authorization: string | null, secret: string | undefined) {
  if (!secret || secret.length < 32) return false;
  const prefix = "Bearer ";
  if (!authorization?.startsWith(prefix)) return false;
  const candidate = authorization.slice(prefix.length);
  return timingSafeEqual(digest(candidate), digest(secret));
}
