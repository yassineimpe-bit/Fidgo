import { createPrivateKey, X509Certificate } from "node:crypto";
import { getAppUrl, type AppUrlEnv } from "@/lib/app-url";
import { isValidGoogleIssuerId } from "@/lib/google-wallet-config";

export type WalletProviderStatus = {
  enabled: boolean;
  configured: boolean;
  missing: string[];
  invalid: string[];
};

export type WalletRuntimeStatus = {
  appUrlConfigured: boolean;
  appUrlHttps: boolean;
  apple: WalletProviderStatus;
  google: WalletProviderStatus;
};

type EnvLike = AppUrlEnv;

function decodeBase64(value: string) {
  const normalized = value.replace(/\s+/g, "");
  if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) throw new Error("INVALID_BASE64");
  const buffer = Buffer.from(normalized, "base64");
  if (!buffer.length) throw new Error("INVALID_BASE64");
  return buffer;
}

function validateApple(env: EnvLike) {
  const invalid: string[] = [];

  const certKeys = ["APPLE_WWDR_CERT_BASE64", "APPLE_SIGNER_CERT_BASE64"] as const;
  for (const key of certKeys) {
    const value = env[key];
    if (!value) continue;
    try {
      new X509Certificate(decodeBase64(value));
    } catch {
      invalid.push(key);
    }
  }

  const signerKey = env.APPLE_SIGNER_KEY_BASE64;
  if (signerKey) {
    try {
      createPrivateKey({
        key: decodeBase64(signerKey),
        format: "pem",
        passphrase: env.APPLE_SIGNER_KEY_PASSPHRASE || undefined,
      });
    } catch {
      invalid.push("APPLE_SIGNER_KEY_BASE64");
    }
  }

  const authSecret = env.AUTH_SECRET;
  if (authSecret && authSecret.trim().length < 32) invalid.push("AUTH_SECRET");

  return invalid;
}

function validateGoogle(env: EnvLike) {
  const invalid: string[] = [];
  const issuerId = env.GOOGLE_WALLET_ISSUER_ID;
  if (issuerId && !isValidGoogleIssuerId(issuerId)) invalid.push("GOOGLE_WALLET_ISSUER_ID");

  const encoded = env.GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_BASE64;
  if (encoded) {
    try {
      const parsed = JSON.parse(decodeBase64(encoded).toString("utf8")) as {
        client_email?: unknown;
        private_key?: unknown;
      };
      if (typeof parsed.client_email !== "string" || !parsed.client_email.includes("@")) {
        throw new Error("INVALID_CLIENT_EMAIL");
      }
      if (typeof parsed.private_key !== "string" || !parsed.private_key.trim()) {
        throw new Error("INVALID_PRIVATE_KEY");
      }
      createPrivateKey(parsed.private_key);
    } catch {
      invalid.push("GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_BASE64");
    }
  }

  return invalid;
}

function providerStatus(
  enabledKey: string,
  required: string[],
  env: EnvLike,
  validate: (env: EnvLike) => string[],
): WalletProviderStatus {
  const enabled = env[enabledKey] === "true";
  const missing = required.filter((key) => !env[key]?.trim());
  const invalid = enabled ? validate(env).filter((key) => !missing.includes(key)) : [];
  return { enabled, configured: enabled && missing.length === 0 && invalid.length === 0, missing, invalid };
}

export function getWalletRuntimeStatus(env: EnvLike = process.env): WalletRuntimeStatus {
  const appUrl = getAppUrl(env);
  let appUrlHttps = false;
  try {
    appUrlHttps = new URL(appUrl).protocol === "https:";
  } catch {
    appUrlHttps = false;
  }
  return {
    appUrlConfigured: Boolean(appUrl),
    appUrlHttps,
    apple: providerStatus("APPLE_WALLET_ENABLED", [
      "APPLE_PASS_TYPE_IDENTIFIER",
      "APPLE_TEAM_IDENTIFIER",
      "APPLE_WWDR_CERT_BASE64",
      "APPLE_SIGNER_CERT_BASE64",
      "APPLE_SIGNER_KEY_BASE64",
      "AUTH_SECRET",
    ], env, validateApple),
    google: providerStatus("GOOGLE_WALLET_ENABLED", [
      "GOOGLE_WALLET_ISSUER_ID",
      "GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_BASE64",
    ], env, validateGoogle),
  };
}
