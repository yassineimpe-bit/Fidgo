import { describe, expect, it } from "vitest";
import { defaultUnits, formatUnits, normalizeUnitLabel, programUnits } from "@/lib/program-units";

describe("libellé d'unité du programme", () => {
  it("retombe sur tampon / point sans libellé", () => {
    expect(programUnits("STAMPS", null, null)).toEqual({ singular: "tampon", plural: "tampons" });
    expect(programUnits("POINTS", "", undefined)).toEqual({ singular: "point", plural: "points" });
    expect(defaultUnits("POINTS")).toEqual({ singular: "point", plural: "points" });
  });

  it("utilise le libellé du commerce et déduit un pluriel régulier", () => {
    expect(programUnits("STAMPS", "café", null)).toEqual({ singular: "café", plural: "cafés" });
    expect(programUnits("STAMPS", "croix", null)).toEqual({ singular: "croix", plural: "croix" });
    expect(programUnits("STAMPS", "bijou", "bijoux")).toEqual({ singular: "bijou", plural: "bijoux" });
  });

  it("accorde selon le nombre", () => {
    const units = programUnits("STAMPS", "café", null);
    expect(formatUnits(1, units)).toBe("1 café");
    expect(formatUnits(0, units)).toBe("0 café");
    expect(formatUnits(3, units)).toBe("3 cafés");
  });

  it("n'accepte que des mots courts, sans balise ni chiffre", () => {
    expect(normalizeUnitLabel("  Pain   au chocolat ")).toBe("pain au chocolat");
    expect(normalizeUnitLabel("crêpe")).toBe("crêpe");
    expect(normalizeUnitLabel("chou-fleur")).toBe("chou-fleur");
    expect(normalizeUnitLabel("")).toBeNull();
    expect(normalizeUnitLabel(null)).toBeNull();
    expect(normalizeUnitLabel("<b>café</b>")).toBeUndefined();
    expect(normalizeUnitLabel("10 cafés")).toBeUndefined();
    expect(normalizeUnitLabel("x".repeat(25))).toBeUndefined();
    expect(normalizeUnitLabel(42)).toBeUndefined();
  });
});
