import type { WalletRuntimeStatus } from "@/lib/wallet-status";

export type WalletMerchantState = {
  label: "Disponible" | "Intervention technique nécessaire" | "Configuration incomplète" | "Non activé";
  ok: boolean;
  message: string;
};

/**
 * Vue commerçant d'un portefeuille, sans nom de variable ni jargon
 * d'infrastructure. Même règle que la carte client (/c/[token]) : le bouton
 * n'y est proposé que si l'URL HTTPS et le fournisseur sont prêts.
 */
export function walletMerchantState(status: WalletRuntimeStatus, provider: "apple" | "google"): WalletMerchantState {
  const name = provider === "apple" ? "Apple Wallet" : "Google Wallet";
  const current = status[provider];
  const https = status.appUrlConfigured && status.appUrlHttps;
  if (current.configured && https) {
    return { label: "Disponible", ok: true, message: `Tes clients peuvent ajouter leur carte à ${name} depuis leur carte web.` };
  }
  if (current.configured) {
    return { label: "Intervention technique nécessaire", ok: false, message: `Configuration ${provider === "apple" ? "Apple" : "Google"} validée, mais l’adresse du site n’est pas encore prête : le bouton n’est pas proposé aux clients. Contacte le support Retiko.` };
  }
  if (current.enabled) {
    return { label: "Configuration incomplète", ok: false, message: `Une intervention technique est nécessaire avant de proposer ${name}. Contacte le support Retiko.` };
  }
  return { label: "Non activé", ok: false, message: `${name} n’est pas proposé à tes clients pour le moment. Leur carte web fonctionne normalement.` };
}
