import { describe, expect, it } from "vitest";
import {
  ADJUSTMENT_ERRORS,
  adjustmentErrorMessage,
  checkAdjustment,
  describeVariation,
  parseVariation,
} from "@/lib/balance-adjustment";
import { defaultUnits } from "@/lib/program-units";

const stamps = defaultUnits("STAMPS");

describe("ajustement manuel : variation saisie", () => {
  it("accepte un entier signé non nul, avec ou sans signe, espaces et moins typographique", () => {
    expect(parseVariation("+2")).toBe(2);
    expect(parseVariation("2")).toBe(2);
    expect(parseVariation("-1")).toBe(-1);
    expect(parseVariation(" − 3 ")).toBe(-3);
  });

  it("refuse zéro, les décimales et le texte", () => {
    for (const value of ["", "0", "+0", "1.5", "1,5", "abc", "--1", "2+"]) expect(parseVariation(value)).toBeNull();
  });
});

describe("ajustement manuel : contrôle avant confirmation", () => {
  it("calcule le nouveau solde envoyé à l'API", () => {
    expect(checkAdjustment(8, "+2", "Crédit oublié")).toEqual({ ok: true, oldBalance: 8, variation: 2, newBalance: 10 });
    expect(checkAdjustment(8, "-8", "Doublon")).toEqual({ ok: true, oldBalance: 8, variation: -8, newBalance: 0 });
  });

  it("refuse un solde négatif, une variation invalide et un motif vide", () => {
    expect(checkAdjustment(2, "-3", "Retrait")).toEqual({ ok: false, error: "NEGATIVE" });
    expect(checkAdjustment(2, "0", "Retrait")).toEqual({ ok: false, error: "VARIATION" });
    expect(checkAdjustment(2, "+1", "   ")).toEqual({ ok: false, error: "REASON" });
    expect(ADJUSTMENT_ERRORS.REASON).toBe("Le motif est obligatoire.");
  });

  it("indique le sens par un signe et un mot, jamais par la seule couleur", () => {
    expect(describeVariation(2, stamps)).toBe("+2 tampons (ajout)");
    expect(describeVariation(-1, stamps)).toBe("−1 tampon (retrait)");
  });

  it("traduit chaque refus de l'API sans jargon", () => {
    expect(adjustmentErrorMessage(409, "BALANCE_CHANGED")).toContain("Le solde a changé");
    expect(adjustmentErrorMessage(409, "NO_CHANGE")).toContain("aucun ajustement");
    expect(adjustmentErrorMessage(404, "CARD_NOT_FOUND")).toContain("Carte introuvable");
    expect(adjustmentErrorMessage(403, "FORBIDDEN")).toContain("ne peut pas");
    expect(adjustmentErrorMessage(400, "INVALID_INPUT")).toContain("240 caractères");
    expect(adjustmentErrorMessage(500, "CARD_ADJUST_FAILED")).not.toMatch(/CARD_|idempotency/i);
  });
});
