import { describe, expect, it } from "vitest";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";

const SECRET = "a".repeat(48);

describe("cron authorization", () => {
  it("accepts only the exact bearer secret", () => {
    expect(isAuthorizedCronRequest(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(isAuthorizedCronRequest(`Bearer ${SECRET}x`, SECRET)).toBe(false);
  });

  it("rejects missing or malformed authorization", () => {
    expect(isAuthorizedCronRequest(null, SECRET)).toBe(false);
    expect(isAuthorizedCronRequest(SECRET, SECRET)).toBe(false);
  });

  it("fails closed when CRON_SECRET is missing or too short", () => {
    expect(isAuthorizedCronRequest("Bearer whatever", undefined)).toBe(false);
    expect(isAuthorizedCronRequest("Bearer short", "short")).toBe(false);
  });
});
