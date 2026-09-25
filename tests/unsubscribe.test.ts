import { beforeAll, describe, expect, it } from "vitest";
import { unsubscribePath, unsubscribeToken, verifyUnsubscribeToken } from "@/lib/unsubscribe";

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret-for-unsubscribe-unit-tests-only-0123456789";
});

const CUSTOMER = "123e4567-e89b-42d3-a456-426614174000";

describe("lien de désabonnement", () => {
  it("aller-retour : court, sans l'identifiant en clair, stable", () => {
    const token = unsubscribeToken(CUSTOMER);
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{24}$/);
    expect(token).not.toContain(CUSTOMER);
    expect(unsubscribeToken(CUSTOMER)).toBe(token);
    expect(verifyUnsubscribeToken(token)).toBe(CUSTOMER);
    expect(unsubscribePath(CUSTOMER)).toBe(`/unsubscribe/${token}`);
  });

  it("refuse un jeton modifié, tronqué ou pour un autre client", () => {
    const token = unsubscribeToken(CUSTOMER);
    const [id, sig] = token.split(".");
    const other = unsubscribeToken("223e4567-e89b-42d3-a456-426614174000");
    expect(verifyUnsubscribeToken(`${other.split(".")[0]}.${sig}`)).toBeNull();
    expect(verifyUnsubscribeToken(`${id}.${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`)).toBeNull();
    expect(verifyUnsubscribeToken(`${id}.${sig.slice(0, 10)}`)).toBeNull();
    expect(verifyUnsubscribeToken(id)).toBeNull();
    expect(verifyUnsubscribeToken(`${token}.x`.repeat(3))).toBeNull();
    expect(verifyUnsubscribeToken(undefined)).toBeNull();
    expect(verifyUnsubscribeToken(42)).toBeNull();
    expect(() => unsubscribeToken("not-a-uuid")).toThrow();
  });

  it("invalide avec un autre AUTH_SECRET", () => {
    const token = unsubscribeToken(CUSTOMER);
    const previous = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "another-secret-entirely-different-0123456789";
    try {
      expect(verifyUnsubscribeToken(token)).toBeNull();
    } finally {
      process.env.AUTH_SECRET = previous;
    }
  });
});
