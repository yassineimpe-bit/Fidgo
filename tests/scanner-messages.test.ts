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
    expect(scannerErrorInfo(new Error("STALE_CARD_STATE"))).toMatchObject({
      code: "STALE_CARD_STATE",
      retryable: false,
    });
    expect(scannerErrorInfo(new Error("BILLING_REQUIRED"))).toMatchObject({
      retryable: false,
      sessionExpired: false,
      message: expect.stringContaining("abonnement"),
    });
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

  it("shows a clear rate-limit message for the code enforceRateLimit() actually returns", () => {
    // Bug réel : enforceRateLimit() (lib/rate-limit.ts) renvoie {error:"RATE_LIMITED"}
    // sur scan/lookup/credit/redeem, mais seul TOO_MANY_ATTEMPTS avait un message dédié.
    const info = scannerErrorInfo(new Error("RATE_LIMITED"));
    expect(info.message).toBe("Trop de tentatives. Réessayez dans quelques instants.");
    expect(info.retryable).toBe(true);
  });

  it("fails unknown backend codes safely without exposing them as the main message", () => {
    const info = scannerErrorInfo(new Error("SOME_INTERNAL_FAILURE"));
    expect(info.code).toBe("SOME_INTERNAL_FAILURE");
    expect(info.message).toBe("Erreur technique. Réessaie ou recharge le scanner si le problème persiste.");
    expect(info.retryable).toBe(true);
  });
});
