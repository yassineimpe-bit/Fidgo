import { describe, expect, it } from "vitest";
import { boundedInt, boundedNumber, normalizeEmail } from "../lib/input";

describe("input guards", () => {
  it("normalizes valid emails and rejects malformed ones", () => {
    expect(normalizeEmail("  Test@Example.COM ")).toBe("test@example.com");
    expect(normalizeEmail("not-an-email")).toBeNull();
  });
  it("rejects NaN, infinity and out-of-range integers", () => {
    expect(boundedInt("10", { min: 1, max: 20 })).toBe(10);
    expect(boundedInt("1.5", { min: 1, max: 20 })).toBeNull();
    expect(boundedInt(Number.NaN, { min: 1, max: 20 })).toBeNull();
    expect(boundedInt(99, { min: 1, max: 20 })).toBeNull();
  });
  it("accepts bounded decimal values only", () => {
    expect(boundedNumber("1.5", { min: 0.01, max: 10 })).toBe(1.5);
    expect(boundedNumber(Number.POSITIVE_INFINITY, { min: 0.01, max: 10 })).toBeNull();
  });
});
