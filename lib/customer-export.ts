import { csvCell } from "@/lib/transaction-export";

export type CustomerCsvRow = {
  first_name: string | null;
  email: string | null;
  phone: string | null;
  marketing_consent: boolean;
  short_code: string | null;
  balance: number | null;
  created_at: string | Date;
};

export function customerExportCsv(rows: CustomerCsvRow[]) {
  const header = ["Nom", "Prénom", "Email", "Téléphone", "Consentement marketing", "Code court", "Solde", "Date d’inscription"];
  const lines = rows.map((row) => [
    "", // Le produit ne collecte pas le nom de famille ; ne jamais l'inventer.
    row.first_name || "",
    row.email || "",
    row.phone || "",
    row.marketing_consent ? "oui" : "non",
    row.short_code || "",
    row.balance ?? 0,
    new Date(row.created_at).toISOString(),
  ].map(csvCell).join(";"));
  return "\uFEFF" + [header.join(";"), ...lines].join("\r\n") + "\r\n";
}
