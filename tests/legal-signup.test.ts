import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LEGAL_VERSION } from "../lib/legal";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("merchant legal acceptance", () => {
  it("requires explicit CGU/CGV acceptance in the signup UI", () => {
    const form = read("components/auth-form.tsx");
    expect(form).toContain('name="legalAccepted"');
    expect(form).toContain("required");
    expect(form).toContain('href="/legal/cgu"');
    expect(form).toContain('href="/legal/cgv"');
    expect(form).toContain('name="marketingOptIn"');
  });

  it("keeps marketing optional and separate from contract acceptance", () => {
    const form = read("components/auth-form.tsx");
    const marketingBlock = form.slice(form.indexOf('name="marketingOptIn"'));
    expect(marketingBlock.slice(0, 250)).not.toContain("required");
    expect(form).toContain("politique de confidentialité");
  });

  it("rejects stale or missing legal acceptance server-side", () => {
    const route = read("app/api/auth/signup/route.ts");
    expect(route).toContain("LEGAL_ACCEPTANCE_REQUIRED");
    expect(route).toContain("legalVersion !== LEGAL_VERSION");
    expect(route).toContain("'CGU'");
    expect(route).toContain("'CGV'");
  });

  it("persists the document type, version and acceptance time", () => {
    const migration = read("db/migrations/018_legal_acceptance.sql");
    expect(migration).toContain("create table if not exists legal_acceptances");
    expect(migration).toContain("document_version text not null");
    expect(migration).toContain("accepted_at timestamptz not null default now()");
    expect(migration).toContain("marketing_consent boolean not null default false");
  });

  it("uses one explicit legal version for the current public documents", () => {
    expect(LEGAL_VERSION).toBe("2026-09-20");
  });
});
