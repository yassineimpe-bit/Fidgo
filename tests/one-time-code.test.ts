import { describe, expect, it } from "vitest";
import { pastedTotpCode, secondFactorPayload } from "@/lib/one-time-code";

describe("code à usage unique collé", () => {
  it("nettoie espaces et tirets d'un code à 6 chiffres", () => {
    expect(pastedTotpCode("123456")).toBe("123456");
    expect(pastedTotpCode(" 123 456 ")).toBe("123456");
    expect(pastedTotpCode("123-456")).toBe("123456");
  });

  it("laisse le collage normal pour tout le reste", () => {
    expect(pastedTotpCode("12345")).toBeNull();
    expect(pastedTotpCode("1234567")).toBeNull();
    expect(pastedTotpCode("ABCDE-FGHIJ")).toBeNull();
    expect(pastedTotpCode("code: 123456")).toBeNull();
  });

  it("distingue code d'application et code de secours même avec une espace", () => {
    expect(secondFactorPayload("123 456")).toEqual({ code: "123456" });
    expect(secondFactorPayload(" abcde-fghij ")).toEqual({ recoveryCode: "abcde-fghij" });
  });
});
