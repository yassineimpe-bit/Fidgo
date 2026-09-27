import { describe, expect, it } from "vitest";
import { walletMerchantState } from "@/lib/wallet-merchant-view";
import type { WalletRuntimeStatus } from "@/lib/wallet-status";

const provider = (enabled: boolean, configured: boolean) => ({ enabled, configured, missing: configured ? [] : ["APPLE_PASS_TYPE_IDENTIFIER"], invalid: [] });
const status = (https: boolean, apple: ReturnType<typeof provider>, google = provider(false, false)): WalletRuntimeStatus => ({ appUrlConfigured: true, appUrlHttps: https, apple, google });

describe("Wallet : vue commerçant sans jargon", () => {
  it("prêt et HTTPS : disponible", () => {
    expect(walletMerchantState(status(true, provider(true, true)), "apple")).toMatchObject({ label: "Disponible", ok: true });
  });

  it("prêt sans HTTPS : intervention technique, comme le bouton absent côté client", () => {
    expect(walletMerchantState(status(false, provider(true, true)), "apple")).toMatchObject({ label: "Intervention technique nécessaire", ok: false });
  });

  it("activé mais incomplet, puis désactivé", () => {
    expect(walletMerchantState(status(true, provider(true, false)), "apple")).toMatchObject({ label: "Configuration incomplète", ok: false });
    expect(walletMerchantState(status(true, provider(false, false)), "google")).toMatchObject({ label: "Non activé", ok: false });
  });

  it("n'expose aucun nom de variable ni terme d'infrastructure", () => {
    for (const https of [true, false]) for (const [enabled, configured] of [[true, true], [true, false], [false, false]] as const) {
      for (const key of ["apple", "google"] as const) {
        const view = walletMerchantState(status(https, provider(enabled, configured), provider(enabled, configured)), key);
        expect(`${view.label} ${view.message}`).not.toMatch(/NEXT_PUBLIC|AUTH_SECRET|Vercel|issuer|service account|Pass Type|certificat|HTTPS|APPLE_|GOOGLE_/i);
      }
    }
  });
});
