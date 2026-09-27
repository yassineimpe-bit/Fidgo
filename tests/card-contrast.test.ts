import { describe, expect, it } from "vitest";
import { contrastRatio, relativeLuminance } from "@/lib/brand-color";
import { cardContrastWarnings, cardDesign, readCardImageOverlay } from "@/lib/card-design";
import { applePassColors } from "@/lib/wallet-colors";

const image = "/api/card-images/123e4567-e89b-42d3-a456-426614174000";

describe("contraste WCAG", () => {
  it("calcule les ratios de référence", () => {
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });
});

describe("avertissements de lisibilité", () => {
  it("rien à signaler pour une couleur lisible", () => {
    expect(cardContrastWarnings({ primaryColor: "#111111" })).toEqual([]);
    expect(cardContrastWarnings({ primaryColor: "#fde047" })).toEqual([]);
  });

  it("signale sans jamais modifier la couleur choisie", () => {
    const warnings = cardContrastWarnings({ primaryColor: "#ff6600" });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("texte blanc");
    expect(warnings[0]).toContain("recommandé : 4,5:1");
    expect(cardDesign({ primaryColor: "#ff6600" }).primary).toBe("#ff6600");
  });

  it("dégradé : l'extrémité la moins contrastée compte", () => {
    const warnings = cardContrastWarnings({ primaryColor: "#000000", secondaryColor: "#ffffff", cardBackground: "gradient" });
    expect(warnings[0]).toContain("Contraste faible sur une partie du dégradé");
    expect(cardContrastWarnings({ primaryColor: "#111111", secondaryColor: "#1e3a8a", cardBackground: "gradient" })).toEqual([]);
  });

  it("couleur secondaire invisible : la barre de progression reprend la couleur du texte, et c'est dit", () => {
    expect(cardContrastWarnings({ primaryColor: "#111111", secondaryColor: "#222222" })).toContain(
      "La couleur secondaire est trop proche du fond pour rester visible : la barre de progression utilise la couleur du texte.",
    );
  });
});

describe("voile sur le visuel : choix explicite", () => {
  it("actif par défaut (rendu inchangé), retirable", () => {
    expect(readCardImageOverlay(undefined)).toBe(true);
    expect(readCardImageOverlay(null)).toBe(true);
    expect(readCardImageOverlay("true")).toBe(true);
    expect(readCardImageOverlay(false)).toBe(false);
    expect(readCardImageOverlay("false")).toBe(false);

    const veiled = cardDesign({ primaryColor: "#111111", cardBackground: "image", cardImageUrl: image });
    expect(veiled.background).toContain("rgba(0, 0, 0, 0.5)");
    expect(veiled.textShadow).toBeNull();
    const plain = cardDesign({ primaryColor: "#111111", cardBackground: "image", cardImageUrl: image, cardImageOverlay: false });
    expect(plain.background).not.toContain("rgba(0, 0, 0, 0.5)");
    expect(plain.background).toContain(image);
    expect(plain.textShadow).toBe("0 1px 3px rgba(0, 0, 0, 0.7)");
    expect(cardContrastWarnings({ primaryColor: "#111111", cardBackground: "image", cardImageUrl: image, cardImageOverlay: false })[0]).toContain("Sans voile");
    expect(cardContrastWarnings({ primaryColor: "#111111", cardBackground: "image", cardImageUrl: image })).toEqual([]);
  });
});

describe("Apple Wallet : texte lisible sur la couleur principale", () => {
  it("texte noir sur fond clair, blanc sur fond foncé, fond inchangé", () => {
    expect(applePassColors("#fde047")).toEqual({ backgroundColor: "rgb(253, 224, 71)", foregroundColor: "rgb(0, 0, 0)", labelColor: "rgb(55, 65, 81)" });
    expect(applePassColors("#111111")).toEqual({ backgroundColor: "rgb(17, 17, 17)", foregroundColor: "rgb(255, 255, 255)", labelColor: "rgb(229, 231, 235)" });
    expect(applePassColors("pas une couleur").backgroundColor).toBe("rgb(17, 24, 39)");
  });
});
