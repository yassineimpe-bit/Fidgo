export type WalletProviderStatus = {
  enabled: boolean;
  configured: boolean;
  missing: string[];
};

export type WalletRuntimeStatus = {
  appUrlConfigured: boolean;
  appUrlHttps: boolean;
  apple: WalletProviderStatus;
  google: WalletProviderStatus;
};

type EnvLike = Record<string, string | undefined>;

function providerStatus(enabledKey: string, required: string[], env: EnvLike): WalletProviderStatus {
  const enabled = env[enabledKey] === "true";
  const missing = required.filter((key) => !env[key]);
  return { enabled, configured: enabled && missing.length === 0, missing };
}

export function getWalletRuntimeStatus(env: EnvLike = process.env): WalletRuntimeStatus {
  const appUrl = env.NEXT_PUBLIC_APP_URL || "";
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
    ], env),
    google: providerStatus("GOOGLE_WALLET_ENABLED", [
      "GOOGLE_WALLET_ISSUER_ID",
      "GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_BASE64",
    ], env),
  };
}
