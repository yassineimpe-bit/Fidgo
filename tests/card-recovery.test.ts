import { describe, expect, it } from "vitest";
import {
  CARD_RECOVERY_TTL_MINUTES,
  createCardRecoveryToken,
  hashCardRecoveryToken,
  isValidCardRecoveryToken,
} from "@/lib/card-recovery";

describe("card recovery tokens", () => {
  it("creates 256-bit base64url tokens and stores only their hash", () => {
    const recovery = createCardRecoveryToken(1_700_000_000_000);
    expect(recovery.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isValidCardRecoveryToken(recovery.token)).toBe(true);
    expect(recovery.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(recovery.tokenHash).not.toContain(recovery.token);
    expect(hashCardRecoveryToken(recovery.token)).toBe(recovery.tokenHash);
  });

  it("expires after the configured short lifetime", () => {
    const now = 1_700_000_000_000;
    const recovery = createCardRecoveryToken(now);
    expect(recovery.expiresAt.getTime()).toBe(now + CARD_RECOVERY_TTL_MINUTES * 60 * 1000);
    expect(CARD_RECOVERY_TTL_MINUTES).toBe(15);
  });

  it("rejects malformed or truncated link tokens", () => {
    expect(isValidCardRecoveryToken("")).toBe(false);
    expect(isValidCardRecoveryToken("a".repeat(42))).toBe(false);
    expect(isValidCardRecoveryToken("a".repeat(44))).toBe(false);
    expect(isValidCardRecoveryToken("!".repeat(43))).toBe(false);
  });

  it("does not generate the same token twice", () => {
    const first = createCardRecoveryToken().token;
    const second = createCardRecoveryToken().token;
    expect(first).not.toBe(second);
  });
});
