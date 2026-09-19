import { createHash, randomBytes } from "node:crypto";

export const PASSWORD_RESET_TTL_MINUTES = 30;

export function hashPasswordResetToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function isValidPasswordResetToken(token: string) {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function createPasswordResetToken(now = Date.now()) {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: hashPasswordResetToken(token),
    expiresAt: new Date(now + PASSWORD_RESET_TTL_MINUTES * 60 * 1000),
  };
}

/**
 * Politique de mot de passe identique à l'inscription (app/api/auth/signup) :
 * une seule politique, jamais deux divergentes.
 */
export function isValidNewPassword(password: string) {
  return typeof password === "string" && password.length >= 8;
}
