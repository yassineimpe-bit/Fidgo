import { describe, expect, it } from "vitest";
import { contrastTextColor, isValidHexColor, normalizeHexColor } from "../lib/brand-color";

describe("isValidHexColor", () => {
  it("accepts strict #RRGGBB, case-insensitive", () => {
    expect(isValidHexColor("#E63946")).toBe(true);
    expect(isValidHexColor("#e63946")).toBe(true);
    expect(isValidHexColor("#000000")).toBe(true);
  });

  it("rejects anything that is not exactly #RRGGBB", () => {
    expect(isValidHexColor("#FFF")).toBe(false);
    expect(isValidHexColor("E63946")).toBe(false);
    expect(isValidHexColor("red")).toBe(false);
    expect(isValidHexColor("rgb(255,0,0)")).toBe(false);
    // Pas de CSS libre : ni une expression, ni une injection de règle.
    expect(isValidHexColor("#111111; background: url(javascript:alert(1))")).toBe(false);
    expect(isValidHexColor("")).toBe(false);
    expect(isValidHexColor(undefined)).toBe(false);
    expect(isValidHexColor(null)).toBe(false);
  });
});

describe("normalizeHexColor", () => {
  it("lowercases a valid color and passes it through", () => {
    expect(normalizeHexColor("#E63946")).toBe("#e63946");
  });

  it("falls back on an invalid or missing color", () => {
    expect(normalizeHexColor("not-a-color")).toBe("#111111");
    expect(normalizeHexColor(undefined, "#ffffff")).toBe("#ffffff");
  });
});

describe("contrastTextColor", () => {
  it("picks white text on dark brand colors", () => {
    expect(contrastTextColor("#111111")).toBe("#ffffff");
    expect(contrastTextColor("#7A3E2D")).toBe("#ffffff");
    expect(contrastTextColor("#000000")).toBe("#ffffff");
  });

  it("picks black text on light brand colors", () => {
    expect(contrastTextColor("#FFFFFF")).toBe("#000000");
    expect(contrastTextColor("#FFEB3B")).toBe("#000000");
  });

  it("never lets an invalid color crash or produce unreadable output", () => {
    // Le cas que la mission interdit explicitement : blanc sur blanc.
    expect(contrastTextColor("#ffffff")).not.toBe("#ffffff");
    expect(contrastTextColor("garbage")).toBe("#ffffff"); // retombe sur le fallback #111111 (sombre) -> texte blanc
  });
});
