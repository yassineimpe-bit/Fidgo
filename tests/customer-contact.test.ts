import { describe, expect, it } from "vitest";
import { changedContactFields, parseCustomerContactUpdate } from "@/lib/customer-contact";

describe("rectification des coordonnées client", () => {
  it("normalise les champs fournis et vide prénom ou téléphone sur demande", () => {
    expect(parseCustomerContactUpdate({ firstName: "  Léa ", email: " LEA@Example.com ", phone: " 06 12 34 56 78 " })).toEqual({
      ok: true,
      update: { firstName: "Léa", email: "lea@example.com", phone: "06 12 34 56 78", withdrawMarketing: false },
    });
    expect(parseCustomerContactUpdate({ firstName: " ", phone: "" })).toEqual({
      ok: true,
      update: { firstName: null, phone: null, withdrawMarketing: false },
    });
  });

  it("refuse un e-mail absent ou invalide, un téléphone ou un prénom douteux", () => {
    for (const body of [
      { email: "" }, { email: "pas-un-email" }, { email: null },
      { phone: "abc" }, { phone: "12" }, { phone: "1".repeat(16) }, { phone: 612345678 },
      { firstName: "<script>" }, { firstName: "a".repeat(81) }, { firstName: "x\u0000" },
      {}, null, [], "texte",
    ]) {
      expect(parseCustomerContactUpdate(body), JSON.stringify(body)).toEqual({ ok: false, error: "INVALID_INPUT" });
    }
  });

  it("autorise le retrait du consentement marketing, jamais son octroi au nom du client", () => {
    expect(parseCustomerContactUpdate({ marketingConsent: false })).toEqual({ ok: true, update: { withdrawMarketing: true } });
    expect(parseCustomerContactUpdate({ marketingConsent: true })).toEqual({ ok: false, error: "CONSENT_REQUIRES_CUSTOMER" });
    expect(parseCustomerContactUpdate({ marketingConsent: "false" })).toEqual({ ok: false, error: "INVALID_INPUT" });
  });

  it("ne liste que les champs réellement modifiés", () => {
    const current = { first_name: "Léa", email: "lea@example.com", phone: null };
    expect(changedContactFields(current, { firstName: "Léa", email: "lea@example.com", phone: null, withdrawMarketing: false })).toEqual([]);
    expect(changedContactFields(current, { firstName: "Lea", phone: "0612345678", withdrawMarketing: false })).toEqual(["firstName", "phone"]);
    expect(changedContactFields(current, { email: "autre@example.com", withdrawMarketing: true })).toEqual(["email"]);
  });
});
