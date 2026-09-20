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

const BCRYPT_MAX_PASSWORD_BYTES = 72;

/**
 * Politique de mot de passe partagée par signup, reset et changement de mot
 * de passe connecté : une seule source, jamais deux règles divergentes.
 * bcrypt ignore silencieusement tout octet au-delà de 72 : sans ce plafond,
 * deux mots de passe partageant les 72 mêmes premiers octets produisent le
 * même hash sans que l'utilisateur ni le code ne le sache.
 */
export function isValidNewPassword(password: string) {
  return typeof password === "string"
    && password.length >= 8
    && new TextEncoder().encode(password).length <= BCRYPT_MAX_PASSWORD_BYTES;
}
