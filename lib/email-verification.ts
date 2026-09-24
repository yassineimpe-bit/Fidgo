import { createHash, randomBytes } from "node:crypto";

export const EMAIL_VERIFICATION_TTL_HOURS = 24;

export function hashEmailVerificationToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function isValidEmailVerificationToken(token: string) {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function emailVerificationTestMode(
  env: Record<string, string | undefined> = process.env,
) {
  return env.NODE_ENV !== "production" && env.EMAIL_VERIFICATION_TEST_MODE === "true";
}

export function createEmailVerificationToken(now = Date.now()) {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: hashEmailVerificationToken(token),
    expiresAt: new Date(now + EMAIL_VERIFICATION_TTL_HOURS * 60 * 60 * 1000),
  };
}
