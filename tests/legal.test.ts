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
  it("utilise l'identité officielle de l'entreprise", () => {
    expect(LEGAL_ENTITY.companyName.value).toBe("Yassine Roussiere");
    expect(LEGAL_ENTITY.tradingName.value).toBe("RETIKO");
    expect(LEGAL_ENTITY.legalForm.value).toBe("Entrepreneur individuel (micro-entreprise)");
    expect(LEGAL_ENTITY.siren.value).toBe("130 906 787");
    expect(LEGAL_ENTITY.siret.value).toBe("130 906 787 00010");
    expect(LEGAL_ENTITY.apeCode.value).toBe("6201Z");
    expect(LEGAL_ENTITY.registration.value).toContain("RNE");
    expect(LEGAL_ENTITY.vatNumber.value).toContain("article 293 B du CGI");
    expect(LEGAL_ENTITY.headOffice.value).toContain("19200 Ussel");
    expect(LEGAL_ENTITY.publicationDirector.value).toBe("Yassine Roussiere");
    expect(LEGAL_ENTITY.phone.value).toBe("07 80 42 62 67");
  });

  it("ne laisse à compléter que les informations encore ouvertes", () => {
    const missing = missingLegalFields();
    expect(missing).not.toContain(LEGAL_ENTITY.siren.label);
    expect(missing).not.toContain(LEGAL_ENTITY.vatNumber.label);
    expect(missing).toContain(LEGAL_ENTITY.privacyContact.label);
    expect(missing).toContain(LEGAL_ENTITY.dpo.label);
    expect(missing).toContain(LEGAL_ENTITY.latePaymentRate.label);
    expect(missing).toContain(LEGAL_ENTITY.jurisdiction.label);
    expect(legalValue(LEGAL_ENTITY.privacyContact)).toBe(TO_COMPLETE);
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
