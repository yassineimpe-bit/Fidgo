import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getWalletRuntimeStatus } from "../lib/wallet-status";

function googleServiceAccountBase64() {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  return Buffer.from(JSON.stringify({
    client_email: "wallet-test@fidgo-test.iam.gserviceaccount.com",
    private_key: pem,
  }), "utf8").toString("base64");
}

describe("wallet runtime status", () => {
  it("reports disabled providers without exposing values", () => {
    const status = getWalletRuntimeStatus({ NEXT_PUBLIC_APP_URL: "https://fidgo.test" });
    expect(status.appUrlHttps).toBe(true);
    expect(status.apple.enabled).toBe(false);
    expect(status.apple.configured).toBe(false);
    expect(status.apple.invalid).toEqual([]);
    expect(status.google.enabled).toBe(false);
    expect(status.google.configured).toBe(false);
    expect(status.google.invalid).toEqual([]);
  });

  it("uses Vercel production URL when no explicit app URL is set", () => {
    const status = getWalletRuntimeStatus({ VERCEL_PROJECT_PRODUCTION_URL: "fidgo.vercel.app" });
    expect(status.appUrlConfigured).toBe(true);
    expect(status.appUrlHttps).toBe(true);
  });

  it("reports Google configured only when enabled, complete and parsable", () => {
    const status = getWalletRuntimeStatus({
      NEXT_PUBLIC_APP_URL: "https://fidgo.test",
      GOOGLE_WALLET_ENABLED: "true",
      GOOGLE_WALLET_ISSUER_ID: "1234567890",
      GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_BASE64: googleServiceAccountBase64(),
    });
    expect(status.google.configured).toBe(true);
    expect(status.google.missing).toEqual([]);
    expect(status.google.invalid).toEqual([]);
  });

  it("rejects malformed Google credentials without exposing their values", () => {
    const status = getWalletRuntimeStatus({
      NEXT_PUBLIC_APP_URL: "https://fidgo.test",
      GOOGLE_WALLET_ENABLED: "true",
      GOOGLE_WALLET_ISSUER_ID: "issuer-not-numeric",
      GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_BASE64: Buffer.from('{"client_email":"bad"}').toString("base64"),
    });
    expect(status.google.configured).toBe(false);
    expect(status.google.missing).toEqual([]);
    expect(status.google.invalid).toContain("GOOGLE_WALLET_ISSUER_ID");
    expect(status.google.invalid).toContain("GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_BASE64");
    expect(JSON.stringify(status)).not.toContain("issuer-not-numeric");
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

  it("marks malformed Apple signing material and weak auth secret invalid", () => {
    const garbage = Buffer.from("not a certificate or private key").toString("base64");
    const status = getWalletRuntimeStatus({
      NEXT_PUBLIC_APP_URL: "https://fidgo.test",
      APPLE_WALLET_ENABLED: "true",
      APPLE_PASS_TYPE_IDENTIFIER: "pass.test.fidgo",
      APPLE_TEAM_IDENTIFIER: "TEAM123456",
      APPLE_WWDR_CERT_BASE64: garbage,
      APPLE_SIGNER_CERT_BASE64: garbage,
      APPLE_SIGNER_KEY_BASE64: garbage,
      AUTH_SECRET: "too-short",
    });
    expect(status.apple.configured).toBe(false);
    expect(status.apple.missing).toEqual([]);
    expect(status.apple.invalid).toEqual(expect.arrayContaining([
      "APPLE_WWDR_CERT_BASE64",
      "APPLE_SIGNER_CERT_BASE64",
      "APPLE_SIGNER_KEY_BASE64",
      "AUTH_SECRET",
    ]));
  });
});
