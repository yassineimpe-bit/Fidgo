import { describe, expect, it } from "vitest";
import { sanitizeGoogleWalletId } from "../lib/google-wallet";
import { appleAuthenticationToken, appleAuthenticationTokenHash } from "../lib/apple-wallet";

describe("wallet helpers", () => {
  it("creates Google-safe object suffixes", () => {
    expect(sanitizeGoogleWalletId("card 12/épreuve")).toBe("card_12__preuve");
  });
  it("derives stable Apple authentication tokens without exposing the card token", () => {
    process.env.AUTH_SECRET = "0123456789abcdef0123456789abcdef";
    const first = appleAuthenticationToken("abcdefghijklmnopqrstuv");
    const second = appleAuthenticationToken("abcdefghijklmnopqrstuv");
    expect(first).toBe(second);
    expect(first).not.toContain("abcdefghijklmnopqrstuv");
    expect(appleAuthenticationTokenHash(first)).toHaveLength(64);
  });
});
