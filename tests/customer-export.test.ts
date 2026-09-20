import { describe, expect, it } from "vitest";
import { customerExportCsv } from "@/lib/customer-export";

describe("export clients CSV", () => {
  it("inclut BOM, séparateur, colonnes attendues et aucun token", () => {
    const csv = customerExportCsv([{
      first_name: "Marie", email: "marie@example.com", phone: "+33612345678",
      marketing_consent: true, short_code: "ABC123", balance: 4,
      created_at: "2026-09-20T12:00:00.000Z",
    }]);
    expect(csv.startsWith("\uFEFFNom;Prénom;Email;Téléphone;Consentement marketing;Code court;Solde;Date d’inscription\r\n"))
      .toBe(true);
    expect(csv).toContain(";Marie;marie@example.com;'+33612345678;oui;ABC123;4;2026-09-20T12:00:00.000Z");
    expect(csv).not.toContain("token");
  });

  it("neutralise les formules même après espaces et échappe guillemets et retours ligne", () => {
    const csv = customerExportCsv([{
      first_name: ' \t=HYPERLINK("https://evil.invalid";"x")', email: null,
      phone: "ligne\nsuivante", marketing_consent: false, short_code: null,
      balance: 0, created_at: "2026-09-20T12:00:00.000Z",
    }]);
    expect(csv).toContain('"\' \t=HYPERLINK(""https://evil.invalid"";""x"")"');
    expect(csv).toContain('"ligne\nsuivante"');
  });
});
