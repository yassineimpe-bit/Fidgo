export const TRANSACTION_HISTORY_PAGE_SIZE = 50;

export const TRANSACTION_TYPE_OPTIONS = [
  { value: "ALL", label: "Tous les types" },
  { value: "earn", label: "Crédits" },
  { value: "redeem", label: "Récompenses" },
  { value: "adjust", label: "Ajustements" },
  { value: "reversal", label: "Annulations" },
] as const;

export const TRANSACTION_PERIOD_OPTIONS = [
  { value: "ALL", label: "Toute la période", days: 0 },
  { value: "7", label: "7 derniers jours", days: 7 },
  { value: "30", label: "30 derniers jours", days: 30 },
  { value: "90", label: "90 derniers jours", days: 90 },
] as const;

export type TransactionTypeFilter = typeof TRANSACTION_TYPE_OPTIONS[number]["value"];
export type TransactionPeriodFilter = typeof TRANSACTION_PERIOD_OPTIONS[number]["value"];

export type TransactionHistoryFilters = {
  q: string;
  type: TransactionTypeFilter;
  period: TransactionPeriodFilter;
  days: number;
  page: number;
  limit: number;
  offset: number;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function parseTransactionHistoryFilters(input: {
  q?: string | string[];
  type?: string | string[];
  period?: string | string[];
  page?: string | string[];
}): TransactionHistoryFilters {
  const q = (first(input.q) || "").trim().slice(0, 120);
  const typeValue = first(input.type) || "ALL";
  const type = TRANSACTION_TYPE_OPTIONS.some((option) => option.value === typeValue)
    ? typeValue as TransactionTypeFilter
    : "ALL";
  const periodValue = first(input.period) || "ALL";
  const periodDefinition = TRANSACTION_PERIOD_OPTIONS.find((option) => option.value === periodValue)
    ?? TRANSACTION_PERIOD_OPTIONS[0];
  const rawPage = Number(first(input.page) || "1");
  const page = Number.isInteger(rawPage) && rawPage > 0 ? Math.min(rawPage, 10_000) : 1;
  return {
    q,
    type,
    period: periodDefinition.value,
    days: periodDefinition.days,
    page,
    limit: TRANSACTION_HISTORY_PAGE_SIZE,
    offset: (page - 1) * TRANSACTION_HISTORY_PAGE_SIZE,
  };
}

export function transactionTypeLabel(type: string) {
  return TRANSACTION_TYPE_OPTIONS.find((option) => option.value === type)?.label.replace(/s$/, "") || type;
}
