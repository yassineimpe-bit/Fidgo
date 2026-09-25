import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Double authentification par application (TOTP, RFC 6238) : HMAC-SHA1,
 * 6 chiffres, pas de 30 s, compatible Google Authenticator, Microsoft
 * Authenticator, 1Password, Bitwarden, etc. Aucune dépendance externe.
 */

export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;
/** Pas acceptés de part et d'autre du pas courant (dérive d'horloge du téléphone). */
export const TOTP_WINDOW = 1;
export const RECOVERY_CODE_COUNT = 10;
export const TOTP_ISSUER = "Retiko";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Buffer | null {
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  if (!/^[A-Z2-7]+$/.test(clean)) return null;
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const char of clean) {
    value = (value << 5) | BASE32.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

/** Secret de 160 bits encodé en base32, à saisir ou scanner dans l'application. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpStep(now = Date.now()): number {
  return Math.floor(now / 1000 / TOTP_PERIOD_SECONDS);
}

export function totpCode(secret: Uint8Array, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", secret).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

/**
 * Pas du code accepté, ou null. Un pas déjà utilisé (ou plus ancien) est
 * refusé : un code intercepté ne peut pas être rejoué.
 */
export function verifyTotp(secretBase32: string, code: string, lastUsedStep: number | null, now = Date.now()): number | null {
  const normalized = code.replace(/\s/g, "");
  if (!new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(normalized)) return null;
  const secret = base32Decode(secretBase32);
  if (!secret || secret.length < 10) return null;
  const current = totpStep(now);
  let matched: number | null = null;
  for (let step = current - TOTP_WINDOW; step <= current + TOTP_WINDOW; step += 1) {
    const expected = Buffer.from(totpCode(secret, step));
    // Comparaison à temps constant, et toutes les fenêtres sont évaluées.
    if (timingSafeEqual(expected, Buffer.from(normalized)) && matched === null) matched = step;
  }
  if (matched === null) return null;
  if (lastUsedStep !== null && matched <= lastUsedStep) return null;
  return matched;
}

export function otpauthUri(secretBase32: string, account: string): string {
  const label = encodeURIComponent(`${TOTP_ISSUER}:${account}`);
  const params = new URLSearchParams({ secret: secretBase32, issuer: TOTP_ISSUER, algorithm: "SHA1", digits: String(TOTP_DIGITS), period: String(TOTP_PERIOD_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}

function derivedKey(purpose: string): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required");
  return Buffer.from(hkdfSync("sha256", secret, "retiko-two-factor", purpose, 32));
}

/**
 * Le secret TOTP est chiffré (AES-256-GCM) avec une clé dérivée d'AUTH_SECRET :
 * une copie de la base seule ne permet pas de générer les codes. Changer
 * AUTH_SECRET rend les secrets existants illisibles (réactivation nécessaire).
 */
export function encryptTotpSecret(secretBase32: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derivedKey("totp-secret-v1"), iv);
  const encrypted = Buffer.concat([cipher.update(secretBase32, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), encrypted.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}

export function decryptTotpSecret(stored: string): string | null {
  const [version, iv, encrypted, tag] = stored.split(".");
  if (version !== "v1" || !iv || !encrypted || !tag) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", derivedKey("totp-secret-v1"), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Codes de secours à usage unique, format XXXXX-XXXXX (50 bits chacun). */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    const raw = base32Encode(randomBytes(7)).slice(0, 10);
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

export function normalizeRecoveryCode(code: string): string | null {
  const clean = code.toUpperCase().replace(/[\s-]/g, "");
  return /^[A-Z2-7]{10}$/.test(clean) ? clean : null;
}

/** Empreinte stockée d'un code de secours (HMAC : inutilisable sans AUTH_SECRET). */
export function hashRecoveryCode(code: string): string | null {
  const normalized = normalizeRecoveryCode(code);
  return normalized ? createHmac("sha256", derivedKey("recovery-code-v1")).update(normalized).digest("hex") : null;
}

/** Clé du jeton « mot de passe vérifié, second facteur attendu », distincte de celle des sessions. */
export function mfaPendingKey(): Uint8Array {
  return new Uint8Array(derivedKey("mfa-pending-v1"));
}
