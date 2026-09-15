import { describe, expect, it } from "vitest";
import { canManageProgram, canScan, computeEarnDelta, isValidIdempotencyKey, parseCardToken } from "@/lib/loyalty";

describe("loyalty core", () => {
  it("extracts secure LOY1 tokens", () => { const token = "abcdefghijklmnopqrstuv"; expect(parseCardToken(`LOY1:${token}`)).toBe(token); expect(parseCardToken("https://example.com")).toBeNull(); });
  it("credits configured stamps only", () => { expect(computeEarnDelta({ mode:"STAMPS", pointsRule:"PER_PURCHASE", stampsPerVisit:2, pointsPerEuro:0, pointsPerPurchase:10, rewardThreshold:10 }, { purchaseAmountCents:999999 })).toBe(2); });
  it("computes integer points from purchase amount in PER_EURO mode", () => { expect(computeEarnDelta({ mode:"POINTS", pointsRule:"PER_EURO", stampsPerVisit:1, pointsPerEuro:1.5, pointsPerPurchase:10, rewardThreshold:100 }, { purchaseAmountCents:1299 })).toBe(19); });
  it("rejects missing purchase amount in PER_EURO mode", () => { expect(computeEarnDelta({ mode:"POINTS", pointsRule:"PER_EURO", stampsPerVisit:1, pointsPerEuro:1, pointsPerPurchase:10, rewardThreshold:100 }, {})).toBe(0); });
  it("uses fixed purchase points in PER_PURCHASE mode", () => { expect(computeEarnDelta({ mode:"POINTS", pointsRule:"PER_PURCHASE", stampsPerVisit:1, pointsPerEuro:5, pointsPerPurchase:10, rewardThreshold:100 }, { purchaseAmountCents:9000 })).toBe(10); });
  it("validates bounded idempotency keys", () => { expect(isValidIdempotencyKey("12345678-abcd")).toBe(true); expect(isValidIdempotencyKey("tiny")).toBe(false); expect(isValidIdempotencyKey("x".repeat(129))).toBe(false); });
  it("enforces role boundaries", () => { expect(canManageProgram("OWNER")).toBe(true); expect(canManageProgram("MANAGER")).toBe(true); expect(canManageProgram("EMPLOYEE")).toBe(false); expect(canScan("EMPLOYEE")).toBe(true); expect(canScan("VIEWER")).toBe(false); });
});
