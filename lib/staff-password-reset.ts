import { createHash, randomBytes } from "node:crypto";

export const STAFF_PASSWORD_RESET_TTL_MINUTES = 30;

type ResetEnv = Record<string, string | undefined>;

export function staffPasswordResetEnabled(env: ResetEnv = process.env) {
  return Boolean(env.RESEND_API_KEY?.trim()) && Boolean(env.EMAIL_FROM?.trim());
}

export function hashStaffResetToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function isValidStaffResetToken(token: string) {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function createStaffResetToken(now = Date.now()) {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: hashStaffResetToken(token),
    expiresAt: new Date(now + STAFF_PASSWORD_RESET_TTL_MINUTES * 60 * 1000),
  };
}
