import { describe, expect, it } from "vitest";
import {
  parseTransactionHistoryFilters,
  TRANSACTION_HISTORY_PAGE_SIZE,
  transactionTypeLabel,
} from "@/lib/transaction-history";

describe("transaction history filters", () => {
  it("normalise les filtres inconnus sans laisser le client injecter un type arbitraire", () => {
    expect(parseTransactionHistoryFilters({
      q: "  Camille  ",
      type: "drop-table",
      period: "365",
      page: "-4",
    })).toEqual({
      q: "Camille",
      type: "ALL",
      period: "ALL",
      days: 0,
      page: 1,
      limit: TRANSACTION_HISTORY_PAGE_SIZE,
      offset: 0,
    });
  });

  it("calcule la pagination et borne la recherche", () => {
    const filters = parseTransactionHistoryFilters({
      q: "x".repeat(200),
      type: "redeem",
      period: "30",
      page: "3",
    });
    expect(filters.q).toHaveLength(120);
    expect(filters.type).toBe("redeem");
    expect(filters.days).toBe(30);
    expect(filters.offset).toBe(TRANSACTION_HISTORY_PAGE_SIZE * 2);
  });

  it("accepte les valeurs répétées en prenant la première valeur", () => {
    const filters = parseTransactionHistoryFilters({
      type: ["earn", "redeem"],
      period: ["7", "90"],
      page: ["2", "999"],
    });
    expect(filters).toMatchObject({ type: "earn", period: "7", days: 7, page: 2 });
  });

  it("affiche des libellés compréhensibles", () => {
    expect(transactionTypeLabel("earn")).toBe("Crédit");
    expect(transactionTypeLabel("redeem")).toBe("Récompense");
    expect(transactionTypeLabel("adjust")).toBe("Ajustement");
    expect(transactionTypeLabel("reversal")).toBe("Annulation");
  });
});
