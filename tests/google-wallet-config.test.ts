import { describe, expect, it } from "vitest";
import { isValidGoogleIssuerId } from "../lib/google-wallet-config";

describe("isValidGoogleIssuerId", () => {
  it.each([
    ["empty", "", false],
    ["null", null, false],
    ["undefined", undefined, false],
    ["zero", "0", false],
    ["negative", "-1", false],
    ["decimal", "123.45", false],
    ["opaque account id", "BCR2DN6D5K5M36JA", false],
    ["above int64", "9223372036854775808", false],
    ["max int64", "9223372036854775807", true],
    ["valid numeric issuer", "1234567890123456789", true],
  ])("validates %s", (_label, value, expected) => {
    expect(isValidGoogleIssuerId(value)).toBe(expected);
  });
});
