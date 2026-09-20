import { describe, expect, it } from "vitest";
import { parseCustomerNote } from "@/lib/customer-note";

describe("note client interne", () => {
  it("normalise le texte et accepte l’effacement", () => {
    expect(parseCustomerNote("  rendez-vous mardi  ")).toEqual({ ok: true, note: "rendez-vous mardi" });
    expect(parseCustomerNote("  ")).toEqual({ ok: true, note: null });
  });

  it("rejette HTML, contrôles, types non textuels et plus de 500 caractères", () => {
    for (const value of ["<b>test</b>", "a > b", "mot\u0000interdit", "x".repeat(501), {}, null]) {
      expect(parseCustomerNote(value)).toEqual({ ok: false });
    }
    expect(parseCustomerNote("x".repeat(500))).toEqual({ ok: true, note: "x".repeat(500) });
  });
});
