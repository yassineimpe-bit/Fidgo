import { describe, expect, it } from "vitest";
import { redactSensitivePath, safeErrorCode, sanitizeAuditText } from "../lib/observability";

describe("observability path redaction", () => {
  it("redacts long opaque card and recovery tokens", () => {
    expect(redactSensitivePath("/c/abcdefghijklmnopqrstuvwxyz0123456789"))
      .toBe("/c/[redacted]");
    expect(redactSensitivePath("/recover/ABCDEFGHIJKLMNOPQRSTUVWX_123456"))
      .toBe("/recover/[redacted]");
  });

  it("redacts UUIDs and strips query strings/fragments", () => {
    expect(redactSensitivePath("/dashboard/customers/819cb31f-dc46-451c-9811-66e82243455a?tab=history#x"))
      .toBe("/dashboard/customers/[id]");
  });

  it("keeps ordinary static routes readable", () => {
    expect(redactSensitivePath("/dashboard/poster"))
      .toBe("/dashboard/poster");
  });

  it("redacts emails, card links, provider keys and control characters from audit text", () => {
    const text = sanitizeAuditText("client@example.com https://retiko.fr/c/abcdefghijklmnopqrstuvwxyz0123456789 re_abcdefghijklmnop\nraison");
    expect(text).toBe("[email] [sensitive-link] [secret] raison");
  });

  it("reduces provider and database failures to non-sensitive codes", () => {
    expect(safeErrorCode(new Error("APPLE_APNS_410:{email: client@example.com}"), "APPLE_FAILED"))
      .toBe("APPLE_APNS_410");
    const dbError = Object.assign(new Error("duplicate key contains client@example.com"), { code: "23505" });
    expect(safeErrorCode(dbError, "DB_FAILED")).toBe("23505");
    const suspiciousCode = Object.assign(new Error("provider failure"), { code: "re_secretProviderCredential" });
    expect(safeErrorCode(suspiciousCode, "PROVIDER_FAILED")).toMatch(/^PROVIDER_FAILED_[a-f0-9]{8}$/);
    expect(safeErrorCode(new Error("Bearer secret-value-for-provider"), "UNKNOWN"))
      .toMatch(/^UNKNOWN_[a-f0-9]{8}$/);
  });
});
