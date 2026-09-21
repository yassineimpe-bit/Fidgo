import { describe, expect, it } from "vitest";
import {
  EMAIL_VERIFICATION_TTL_HOURS,
  createEmailVerificationToken,
  hashEmailVerificationToken,
  isValidEmailVerificationToken,
} from "@/lib/email-verification";

describe("email verification token", () => {
  it("creates a 256-bit base64url token and stores only its SHA-256 hash", () => {
    const now = Date.UTC(2026, 8, 21, 12, 0, 0);
    const created = createEmailVerificationToken(now);

    expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(created.tokenHash).toBe(hashEmailVerificationToken(created.token));
    expect(created.expiresAt.getTime()).toBe(now + EMAIL_VERIFICATION_TTL_HOURS * 60 * 60 * 1000);
  });

  it("rejects malformed token shapes before hashing or database lookup", () => {
    expect(isValidEmailVerificationToken("a".repeat(43))).toBe(true);
    expect(isValidEmailVerificationToken("a".repeat(42))).toBe(false);
    expect(isValidEmailVerificationToken("a".repeat(44))).toBe(false);
    expect(isValidEmailVerificationToken(`${"a".repeat(42)}+`)).toBe(false);
  });
});
