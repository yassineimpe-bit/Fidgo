import { createHash, randomBytes } from "node:crypto";

export const CARD_RECOVERY_TTL_MINUTES = 15;

type RecoveryEnv = Record<string, string | undefined>;

export function cardRecoveryEnabled(env: RecoveryEnv = process.env) {
  return env.CARD_RECOVERY_ENABLED === "true"
    && Boolean(env.RESEND_API_KEY?.trim())
    && Boolean(env.EMAIL_FROM?.trim())
    && Boolean(env.EMAIL_REPLY_TO?.trim());
}

export function hashCardRecoveryToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function isValidCardRecoveryToken(token: string) {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function createCardRecoveryToken(now = Date.now()) {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: hashCardRecoveryToken(token),
    expiresAt: new Date(now + CARD_RECOVERY_TTL_MINUTES * 60 * 1000),
  };
}
