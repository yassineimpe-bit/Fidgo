import { describe, expect, it } from "vitest";
import { cardDesign, isCardBackground } from "@/lib/card-design";

describe("apparence de la carte", () => {
  it("couleur unie : fond principal, texte contrasté, accent secondaire s'il reste lisible", () => {
    expect(cardDesign({ primaryColor: "#1D4ED8" })).toEqual({
      background: "#1d4ed8", textColor: "#ffffff", accentColor: "#ffffff", primary: "#1d4ed8", secondary: null,
    });
    // Jaune clair sur fond bleu foncé : lisible, utilisé comme accent.
    expect(cardDesign({ primaryColor: "#1d4ed8", secondaryColor: "#FDE047" }).accentColor).toBe("#fde047");
    // Bleu marine sur fond bleu : illisible, l'accent retombe sur le texte.
    expect(cardDesign({ primaryColor: "#1d4ed8", secondaryColor: "#0b1f4d" }).accentColor).toBe("#ffffff");
  });

  it("dégradé : seulement avec une couleur secondaire, texte réglé sur la teinte moyenne", () => {
    const design = cardDesign({ primaryColor: "#111111", secondaryColor: "#fde047", cardBackground: "gradient" });
    expect(design.background).toBe("linear-gradient(135deg, #111111 0%, #fde047 100%)");
    expect(design.textColor).toBe("#ffffff");
    expect(cardDesign({ primaryColor: "#fef9c3", secondaryColor: "#fde047", cardBackground: "gradient" }).textColor).toBe("#000000");
    expect(cardDesign({ primaryColor: "#111111", cardBackground: "gradient" }).background).toBe("#111111");
  });

  it("ignore les valeurs invalides", () => {
    expect(cardDesign({ primaryColor: "red", secondaryColor: "javascript:alert(1)", cardBackground: "gradient" })).toMatchObject({ background: "#111111", secondary: null });
    expect(isCardBackground("gradient")).toBe(true);
    expect(isCardBackground("image")).toBe(true);
    expect(isCardBackground("video")).toBe(false);
  });

  it("fond image : visuel importé uniquement, voile sombre et texte blanc", () => {
    const url = "/api/card-images/123e4567-e89b-42d3-a456-426614174000";
    const design = cardDesign({ primaryColor: "#fef9c3", cardBackground: "image", cardImageUrl: url });
    expect(design.background).toBe(`linear-gradient(rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0.5)), url("${url}") center / cover no-repeat, #fef9c3`);
    expect(design.textColor).toBe("#ffffff");
    // Sans visuel, ou avec une URL qui n'est pas un visuel importé : couleur unie.
    expect(cardDesign({ primaryColor: "#fef9c3", cardBackground: "image" }).background).toBe("#fef9c3");
    expect(cardDesign({ primaryColor: "#fef9c3", cardBackground: "image", cardImageUrl: 'https://evil.example/x.png") ; background:url("x' }).background).toBe("#fef9c3");
  });
});
