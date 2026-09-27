import { describe, expect, it } from "vitest";
import { scannerActionErrorInfo, scannerErrorInfo } from "@/lib/scanner-messages";
import { redeemPreview, scanErrorFeedback } from "@/lib/scanner-feedback";

describe("confirmation d'utilisation d'une récompense", () => {
  it("affiche le coût, le solde actuel et le solde après, comme /api/redeem", () => {
    expect(redeemPreview(135, 100)).toEqual({ cost: 100, before: 135, after: 35 });
    expect(redeemPreview(10, 10)).toEqual({ cost: 10, before: 10, after: 0 });
    // Deux récompenses possibles : une seule est consommée par confirmation.
    expect(redeemPreview(250, 100)).toEqual({ cost: 100, before: 250, after: 150 });
  });

  it("ne propose rien si le solde affiché ne suffit pas ou si le seuil est invalide", () => {
    expect(redeemPreview(99, 100)).toBeNull();
    expect(redeemPreview(5, 0)).toBeNull();
    expect(redeemPreview(Number.NaN, 10)).toBeNull();
  });

  it("parle d'une récompense, jamais d'un crédit, en cas de réseau", () => {
    const lost = scannerActionErrorInfo(new TypeError("Failed to fetch"), "redeem");
    expect(lost).toMatchObject({ code: "NETWORK_ERROR", retryable: true, network: true });
    expect(lost.message).toContain("n’a pas été confirmée");
    expect(lost.message).not.toContain("crédit");

    const offline = scannerActionErrorInfo(new Error("OFFLINE"), "redeem");
    expect(offline.message).toContain("Connexion internet nécessaire");
    expect(offline.message).toContain("n’a pas été utilisée");
    expect(offline.message).not.toContain("crédit");

    // Le crédit garde son message d'origine.
    expect(scannerActionErrorInfo(new TypeError("Failed to fetch"), "credit").message)
      .toBe(scannerErrorInfo(new TypeError("Failed to fetch")).message);
  });

  it("solde consommé ailleurs : refus compréhensible, pas de relance", () => {
    const info = scannerActionErrorInfo(new Error("INSUFFICIENT_BALANCE"), "redeem");
    expect(info).toMatchObject({ retryable: false, network: false });
    expect(info.message).toContain("Le solde a changé. Cette récompense n’est plus disponible.");
    expect(scanErrorFeedback(info)).toEqual({ tone: "refused", title: "Récompense indisponible" });
  });
});
