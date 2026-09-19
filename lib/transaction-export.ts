export type TransactionExportRow = {
  created_at: string | Date;
  first_name?: string | null;
  short_code: string;
  type: string;
  delta: number;
  balance_after: number;
  unit: string;
  staff_email?: string | null;
  reversed: boolean;
};

function csvCell(value: unknown) {
  let text = value == null ? "" : String(value);
  // Les tableurs interprètent =, +, - et @ en début de cellule comme des
  // formules. Les prénoms proviennent du client : neutraliser l'injection CSV.
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  if (!/[;"\r\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

export function transactionExportCsv(rows: TransactionExportRow[]) {
  const header = [
    "Date",
    "Client",
    "Code carte",
    "Type",
    "Variation",
    "Solde après",
    "Unité",
    "Employé",
    "Annulée",
  ];
  const lines = rows.map((row) => [
    new Date(row.created_at).toISOString(),
    row.first_name || "",
    row.short_code,
    row.type,
    row.delta,
    row.balance_after,
    row.unit,
    row.staff_email || "système",
    row.reversed ? "oui" : "non",
  ].map(csvCell).join(";"));
  return "\uFEFF" + [header.join(";"), ...lines].join("\r\n") + "\r\n";
}
