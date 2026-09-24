import { describe, expect, it } from "vitest";
import { ADMIN_PAGE_SIZE, isUuid, likePattern, parseAdminSearch, parseSuspensionReason } from "../lib/platform-admin";

describe("super-admin : motif de suspension", () => {
  it("exige 10 à 500 caractères de texte brut", () => {
    expect(parseSuspensionReason("Impayé depuis 60 jours")).toBe("Impayé depuis 60 jours");
    expect(parseSuspensionReason("  trop   \n court ")).toBe("trop court");
    expect(parseSuspensionReason("  court \n ")).toBeNull();
    expect(parseSuspensionReason(42)).toBeNull();
    expect(parseSuspensionReason(undefined)).toBeNull();
    expect(parseSuspensionReason("x".repeat(600))).toHaveLength(500);
  });

  it("refuse le balisage et masque emails et secrets", () => {
    expect(parseSuspensionReason("<script>alert(1)</script> fraude")).toBeNull();
    expect(parseSuspensionReason("Signalé par client@example.com pour abus")).toBe("Signalé par [email] pour abus");
  });
});

describe("super-admin : recherche et pagination", () => {
  it("borne la recherche et la page", () => {
    expect(parseAdminSearch({ q: "  Boulangerie  ", page: "3" })).toEqual({ q: "Boulangerie", page: 3, offset: 2 * ADMIN_PAGE_SIZE });
    expect(parseAdminSearch({ q: "a".repeat(300) }).q).toHaveLength(120);
    for (const page of ["0", "-1", "abc", "1.5", "999999"]) expect(parseAdminSearch({ page }).page).toBe(1);
    expect(parseAdminSearch({ q: ["x", "y"], page: ["2"] })).toMatchObject({ q: "x", page: 2 });
  });

  it("échappe les jokers LIKE pour une recherche littérale", () => {
    expect(likePattern("100%_ok\\")).toBe("%100\\%\\_ok\\\\%");
    expect(likePattern("Café")).toBe("%café%");
  });

  it("valide les identifiants de commerce", () => {
    expect(isUuid("3f2a9c1e-8b4d-4e6f-9a0b-1c2d3e4f5a6b")).toBe(true);
    expect(isUuid("../etc/passwd")).toBe(false);
    expect(isUuid("3f2a9c1e-8b4d-4e6f-9a0b-1c2d3e4f5a6")).toBe(false);
  });
});
