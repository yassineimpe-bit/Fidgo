import { describe, expect, it } from "vitest";
import { redactSensitivePath } from "../lib/observability";

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
});
