import { describe, expect, it } from "vitest";
import {
  STAFF_PASSWORD_RESET_TTL_MINUTES,
  createStaffResetToken,
  hashStaffResetToken,
  isValidStaffResetToken,
  staffPasswordResetEnabled,
} from "@/lib/staff-password-reset";

describe("staff password reset tokens", () => {
  it("creates 256-bit base64url tokens and stores only their hash", () => {
    const reset = createStaffResetToken(1_700_000_000_000);
    expect(reset.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isValidStaffResetToken(reset.token)).toBe(true);
    expect(reset.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(reset.tokenHash).not.toContain(reset.token);
    expect(hashStaffResetToken(reset.token)).toBe(reset.tokenHash);
  });

  it("expires after the configured short lifetime", () => {
    const now = 1_700_000_000_000;
    const reset = createStaffResetToken(now);
    expect(reset.expiresAt.getTime()).toBe(now + STAFF_PASSWORD_RESET_TTL_MINUTES * 60 * 1000);
    expect(STAFF_PASSWORD_RESET_TTL_MINUTES).toBe(30);
  });

  it("rejects malformed or truncated link tokens", () => {
    expect(isValidStaffResetToken("")).toBe(false);
    expect(isValidStaffResetToken("a".repeat(42))).toBe(false);
    expect(isValidStaffResetToken("a".repeat(44))).toBe(false);
    expect(isValidStaffResetToken("!".repeat(43))).toBe(false);
  });

  it("does not generate the same token twice", () => {
    const first = createStaffResetToken().token;
    const second = createStaffResetToken().token;
    expect(first).not.toBe(second);
  });

  it("stays disabled until the email transport is fully configured", () => {
    expect(staffPasswordResetEnabled({})).toBe(false);
    expect(staffPasswordResetEnabled({ RESEND_API_KEY: "re_test" })).toBe(false);
    expect(staffPasswordResetEnabled({
      RESEND_API_KEY: "re_test",
      EMAIL_FROM: "Fidgo <staff@example.com>",
    })).toBe(true);
  });
});
