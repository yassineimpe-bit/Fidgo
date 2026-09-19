import { describe, expect, it } from "vitest";
import { transactionExportCsv } from "@/lib/transaction-export";

describe("transaction CSV export", () => {
  it("produit un CSV Excel-compatible avec BOM et séparateur point-virgule", () => {
    const csv = transactionExportCsv([{
      created_at: "2026-09-19T20:00:00.000Z",
      first_name: "Camille",
      short_code: "ABC123",
      type: "earn",
      delta: 1,
      balance_after: 4,
      unit: "STAMP",
      staff_email: "staff@example.com",
      reversed: false,
    }]);
    expect(csv.startsWith("\uFEFFDate;Client;")).toBe(true);
    expect(csv).toContain("Camille;ABC123;earn;1;4;STAMP;staff@example.com;non");
  });

  it("neutralise les formules tableur et échappe les cellules complexes", () => {
    const csv = transactionExportCsv([{
      created_at: "2026-09-19T20:00:00.000Z",
      first_name: '=HYPERLINK("https://evil.invalid";"Jean")',
      short_code: "ABC123",
      type: "adjust",
      delta: -1,
      balance_after: 2,
      unit: "STAMP",
      staff_email: null,
      reversed: true,
    }]);
    expect(csv).toContain('"\'=HYPERLINK(""https://evil.invalid"";""Jean"")"');
    expect(csv).toContain(";système;oui");
  });
});
