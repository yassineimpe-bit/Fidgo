import { describe, expect, it } from "vitest";
import { scannerErrorInfo } from "@/lib/scanner-messages";

describe("scannerErrorInfo", () => {
  it("translates loyalty business errors", () => {
    expect(scannerErrorInfo(new Error("COOLDOWN"))).toMatchObject({
      code: "COOLDOWN",
      retryable: true,
      network: false,
    });
    expect(scannerErrorInfo(new Error("INSUFFICIENT_BALANCE"))).toMatchObject({
      code: "INSUFFICIENT_BALANCE",
      retryable: false,
    });
    expect(scannerErrorInfo(new Error("CARD_EXPIRED")).message).toContain("expiré");
  });

  it("recognizes browser fetch failures as safe network retries", () => {
    for (const message of ["Failed to fetch", "Load failed", "NetworkError when attempting to fetch resource."]) {
      expect(scannerErrorInfo(new TypeError(message))).toMatchObject({
        code: "NETWORK_ERROR",
        retryable: true,
        network: true,
      });
    }
  });

  it("marks expired sessions as requiring login", () => {
    expect(scannerErrorInfo(new Error("UNAUTHORIZED"))).toMatchObject({
      retryable: false,
      sessionExpired: true,
    });
  });

  it("fails unknown backend codes safely without exposing them as the main message", () => {
    const info = scannerErrorInfo(new Error("SOME_INTERNAL_FAILURE"));
    expect(info.code).toBe("SOME_INTERNAL_FAILURE");
    expect(info.message).toBe("Erreur technique. Réessaie ou recharge le scanner si le problème persiste.");
    expect(info.retryable).toBe(true);
  });
});
