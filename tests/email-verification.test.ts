import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EMAIL_VERIFICATION_TTL_HOURS,
  createEmailVerificationToken,
  emailVerificationTestMode,
  hashEmailVerificationToken,
  isValidEmailVerificationToken,
} from "@/lib/email-verification";

const migration = readFileSync("db/migrations/021_email_verification.sql", "utf8");

describe("email verification migration", () => {
  it("backfills legacy accounts only when the column is created for the first time", () => {
    expect(migration).toContain("if not exists (");
    expect(migration).toContain("column_name = 'email_verified_at'");
    expect(migration).toMatch(
      /if not exists \([\s\S]*add column email_verified_at[\s\S]*set email_verified_at = created_at[\s\S]*alter table staff_users/,
    );
  });
});

describe("email verification token", () => {
  it("creates a 256-bit base64url token and stores only its SHA-256 hash", () => {
    const now = Date.UTC(2026, 8, 21, 12, 0, 0);
    const created = createEmailVerificationToken(now);

    expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(created.tokenHash).toBe(hashEmailVerificationToken(created.token));
    expect(created.expiresAt.getTime()).toBe(now + EMAIL_VERIFICATION_TTL_HOURS * 60 * 60 * 1000);
  });

  it("rejects malformed token shapes before hashing or database lookup", () => {
    expect(isValidEmailVerificationToken("a".repeat(43))).toBe(true);
    expect(isValidEmailVerificationToken("a".repeat(42))).toBe(false);
    expect(isValidEmailVerificationToken("a".repeat(44))).toBe(false);
    expect(isValidEmailVerificationToken(`${"a".repeat(42)}+`)).toBe(false);
  });

  it("never exposes the E2E token when NODE_ENV is production", () => {
    expect(emailVerificationTestMode({
      NODE_ENV: "production",
      EMAIL_VERIFICATION_TEST_MODE: "true",
    })).toBe(false);
    expect(emailVerificationTestMode({
      NODE_ENV: "test",
      EMAIL_VERIFICATION_TEST_MODE: "true",
    })).toBe(true);
  });
});
