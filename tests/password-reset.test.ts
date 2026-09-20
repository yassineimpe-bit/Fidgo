import { describe, expect, it } from "vitest";
import {
  PASSWORD_RESET_TTL_MINUTES,
  createPasswordResetToken,
  hashPasswordResetToken,
  isValidNewPassword,
  isValidPasswordResetToken,
} from "@/lib/password-reset";

describe("password reset tokens", () => {
  it("creates 256-bit base64url tokens and stores only their hash", () => {
    const reset = createPasswordResetToken(1_700_000_000_000);
    expect(reset.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isValidPasswordResetToken(reset.token)).toBe(true);
    expect(reset.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(reset.tokenHash).not.toContain(reset.token);
    expect(hashPasswordResetToken(reset.token)).toBe(reset.tokenHash);
  });

  it("expires after the configured lifetime", () => {
    const now = 1_700_000_000_000;
    const reset = createPasswordResetToken(now);
    expect(reset.expiresAt.getTime()).toBe(now + PASSWORD_RESET_TTL_MINUTES * 60 * 1000);
    expect(PASSWORD_RESET_TTL_MINUTES).toBe(30);
  });

  it("rejects malformed or truncated link tokens", () => {
    expect(isValidPasswordResetToken("")).toBe(false);
    expect(isValidPasswordResetToken("a".repeat(42))).toBe(false);
    expect(isValidPasswordResetToken("a".repeat(44))).toBe(false);
    expect(isValidPasswordResetToken("!".repeat(43))).toBe(false);
  });

  it("does not generate the same token twice", () => {
    const first = createPasswordResetToken().token;
    const second = createPasswordResetToken().token;
    expect(first).not.toBe(second);
  });

  it("enforces the same 8-character minimum as signup, nothing divergent", () => {
    expect(isValidNewPassword("")).toBe(false);
    expect(isValidNewPassword("short1")).toBe(false);
    expect(isValidNewPassword("1234567")).toBe(false);
    expect(isValidNewPassword("12345678")).toBe(true);
    expect(isValidNewPassword("a-very-long-passphrase")).toBe(true);
  });

  it("rejects passwords beyond bcrypt's 72-byte limit to avoid silent truncation", () => {
    expect(isValidNewPassword("a".repeat(72))).toBe(true);
    expect(isValidNewPassword("a".repeat(73))).toBe(false);
    // Les caractères multi-octets (UTF-8) doivent compter en octets, pas en
    // unités de code JS : "é" (U+00E9) pèse 2 octets.
    expect(isValidNewPassword("é".repeat(36))).toBe(true);
    expect(isValidNewPassword("é".repeat(37))).toBe(false);
  });
});
