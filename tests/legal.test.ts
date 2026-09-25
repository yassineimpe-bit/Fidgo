import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  LEGAL_ENTITY,
  LEGAL_VERSION,
  TO_COMPLETE,
  hasAcceptedCurrentTerms,
  legalValue,
  marketingOptIn,
  missingLegalFields,
} from "@/lib/legal";

const migration = readFileSync("db/migrations/022_legal_acceptance.sql", "utf8");

describe("acceptation CGU/CGV", () => {
  it("exige une case cochée ET la version affichée", () => {
    expect(hasAcceptedCurrentTerms({ legalAccepted: true, legalVersion: LEGAL_VERSION })).toBe(true);
    expect(hasAcceptedCurrentTerms({ legalAccepted: true })).toBe(false);
    expect(hasAcceptedCurrentTerms({ legalAccepted: "true", legalVersion: LEGAL_VERSION })).toBe(false);
    expect(hasAcceptedCurrentTerms({ legalAccepted: false, legalVersion: LEGAL_VERSION })).toBe(false);
    expect(hasAcceptedCurrentTerms({ legalAccepted: true, legalVersion: "2020-01-01" })).toBe(false);
  });

  it("ne déduit jamais un consentement marketing implicite", () => {
    expect(marketingOptIn({ marketingOptIn: true })).toBe(true);
    for (const value of [undefined, false, "true", "on", 1]) expect(marketingOptIn({ marketingOptIn: value })).toBe(false);
  });

  it("utilise une version datée compatible avec la contrainte SQL", () => {
    expect(LEGAL_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("identité juridique", () => {
  it("n'invente aucune donnée d'identification", () => {
    for (const key of ["companyName", "legalForm", "siren", "registration", "vatNumber", "headOffice", "publicationDirector", "privacyContact", "dpo"] as const) {
      expect(LEGAL_ENTITY[key].value).toBeNull();
      expect(legalValue(LEGAL_ENTITY[key])).toBe(TO_COMPLETE);
    }
  });

  it("liste en un seul endroit les informations manquantes", () => {
    const missing = missingLegalFields();
    expect(missing).toContain(LEGAL_ENTITY.siren.label);
    expect(missing).toContain(LEGAL_ENTITY.privacyContact.label);
    expect(missing).not.toContain(LEGAL_ENTITY.contactEmail.label);
  });
});

describe("migration 022", () => {
  it("est rejouable par db:setup", () => {
    expect(migration).toContain("add column if not exists marketing_consent ");
    expect(migration).toContain("create table if not exists legal_acceptances");
    expect(migration).toContain("create index if not exists legal_acceptances_staff_idx");
    expect(migration.match(/if not exists \(select 1 from pg_constraint/g)).toHaveLength(2);
  });

  it("garde la preuve liée au bon commerce et ne la supprime pas en cascade", () => {
    expect(migration).toMatch(/foreign key \(staff_user_id, establishment_id\)\s+references staff_users \(id, establishment_id\)/);
    expect(migration).not.toMatch(/on delete cascade/i);
  });
});
