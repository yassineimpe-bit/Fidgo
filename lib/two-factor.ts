import { SignJWT, jwtVerify } from "jose";
import { sql } from "@/lib/db";
import { decryptTotpSecret, hashRecoveryCode, mfaPendingKey, verifyTotp } from "@/lib/totp";

export const MFA_PENDING_COOKIE = "loyalty_mfa";
const MFA_PENDING_SECONDS = 5 * 60;
const MFA_AUDIENCE = "retiko-mfa-pending";

export function isMissingTable(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && String((error as { code?: unknown }).code) === "42P01";
}

/** Second facteur actif du compte, ou null (aucun, en cours d'activation, ou migration 025 absente). */
export async function enabledTwoFactor(staffId: string): Promise<{ secretEncrypted: string; lastUsedStep: number | null } | null> {
  try {
    const [row] = await sql`
      select secret_encrypted, last_used_step from staff_two_factor
      where staff_user_id=${staffId} and enabled_at is not null
    `;
    return row ? { secretEncrypted: String(row.secret_encrypted), lastUsedStep: row.last_used_step === null ? null : Number(row.last_used_step) } : null;
  } catch (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
}

/**
 * Jeton court « mot de passe vérifié, code attendu ». Signé avec une clé
 * dérivée distincte de celle des sessions : recopié dans le cookie de session,
 * il est rejeté, et il ne donne accès à rien d'autre qu'à la seconde étape.
 */
export async function signMfaPending(staffId: string, tokenVersion: number) {
  return new SignJWT({ tv: tokenVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(staffId)
    .setAudience(MFA_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${MFA_PENDING_SECONDS}s`)
    .sign(mfaPendingKey());
}

export async function verifyMfaPending(token: string | undefined): Promise<{ staffId: string; tokenVersion: number } | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, mfaPendingKey(), { audience: MFA_AUDIENCE });
    const tokenVersion = Number(payload.tv);
    if (!payload.sub || !Number.isInteger(tokenVersion)) return null;
    return { staffId: payload.sub, tokenVersion };
  } catch {
    return null;
  }
}

export function mfaPendingCookie(value: string) {
  return {
    name: MFA_PENDING_COOKIE,
    value,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/api/auth",
    maxAge: MFA_PENDING_SECONDS,
  };
}

export function clearedMfaPendingCookie() {
  return { ...mfaPendingCookie(""), maxAge: 0 };
}

/**
 * Vérifie et consomme un second facteur : code TOTP (pas strictement plus
 * récent que le dernier accepté, mise à jour conditionnelle contre les
 * requêtes simultanées) ou code de secours à usage unique.
 */
export async function consumeSecondFactor(
  staffId: string,
  factor: { secretEncrypted: string; lastUsedStep: number | null },
  input: { code?: string; recoveryCode?: string },
): Promise<"totp" | "recovery_code" | null> {
  if (input.code) {
    const secret = decryptTotpSecret(factor.secretEncrypted);
    const step = secret ? verifyTotp(secret, input.code, factor.lastUsedStep) : null;
    if (step === null) return null;
    const [accepted] = await sql`
      update staff_two_factor set last_used_step=${step}, updated_at=now()
      where staff_user_id=${staffId} and enabled_at is not null
        and (last_used_step is null or last_used_step < ${step})
      returning staff_user_id
    `;
    return accepted ? "totp" : null;
  }
  const hash = input.recoveryCode ? hashRecoveryCode(input.recoveryCode) : null;
  if (!hash) return null;
  const [used] = await sql`
    update staff_two_factor_recovery_codes set used_at=now()
    where staff_user_id=${staffId} and code_hash=${hash} and used_at is null
    returning id
  `;
  return used ? "recovery_code" : null;
}
