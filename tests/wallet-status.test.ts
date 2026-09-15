import { describe, expect, it } from "vitest";
import { getWalletRuntimeStatus } from "../lib/wallet-status";

describe("wallet runtime status", () => {
  it("reports disabled providers without exposing values", () => {
    const status = getWalletRuntimeStatus({ NEXT_PUBLIC_APP_URL: "https://fidgo.test" });
    expect(status.appUrlHttps).toBe(true);
    expect(status.apple.enabled).toBe(false);
    expect(status.apple.configured).toBe(false);
    expect(status.google.enabled).toBe(false);
    expect(status.google.configured).toBe(false);
  });

  it("uses Vercel production URL when no explicit app URL is set", () => {
    const status = getWalletRuntimeStatus({ VERCEL_PROJECT_PRODUCTION_URL: "fidgo.vercel.app" });
    expect(status.appUrlConfigured).toBe(true);
    expect(status.appUrlHttps).toBe(true);
  });

  it("reports Google configured only when enabled and complete", () => {
    const status = getWalletRuntimeStatus({
      NEXT_PUBLIC_APP_URL: "https://fidgo.test",
      GOOGLE_WALLET_ENABLED: "true",
      GOOGLE_WALLET_ISSUER_ID: "123",
      GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_BASE64: "secret",
    });
    expect(status.google.configured).toBe(true);
    expect(status.google.missing).toEqual([]);
  });

  it("requires every Apple signing input and auth secret", () => {
    const status = getWalletRuntimeStatus({
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      APPLE_WALLET_ENABLED: "true",
      APPLE_PASS_TYPE_IDENTIFIER: "pass.test",
      APPLE_TEAM_IDENTIFIER: "TEAM",
    });
    expect(status.appUrlHttps).toBe(false);
    expect(status.apple.configured).toBe(false);
    expect(status.apple.missing).toContain("APPLE_SIGNER_CERT_BASE64");
    expect(status.apple.missing).toContain("APPLE_SIGNER_KEY_BASE64");
    expect(status.apple.missing).toContain("AUTH_SECRET");
  });
});
