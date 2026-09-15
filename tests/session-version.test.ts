import { describe, expect, it } from "vitest";
import { normalizeTokenVersion, sessionVersionMatches } from "@/lib/session-version";

describe("staff session token versions", () => {
  it("accepts non-negative integer versions", () => {
    expect(normalizeTokenVersion(0)).toBe(0);
    expect(normalizeTokenVersion("4")).toBe(4);
  });

  it("rejects missing, negative and fractional versions", () => {
    expect(normalizeTokenVersion(undefined)).toBeNull();
    expect(normalizeTokenVersion(-1)).toBeNull();
    expect(normalizeTokenVersion(1.5)).toBeNull();
    expect(normalizeTokenVersion("not-a-number")).toBeNull();
  });

  it("invalidates a JWT after the DB version changes", () => {
    expect(sessionVersionMatches(2, 2)).toBe(true);
    expect(sessionVersionMatches(2, 3)).toBe(false);
  });

  it("invalidates legacy JWTs without a version claim", () => {
    expect(sessionVersionMatches(undefined, 0)).toBe(false);
  });
});
