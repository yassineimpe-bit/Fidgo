import { describe, expect, it } from "vitest";
import { CUSTOMER_HISTORY_PAGE_SIZE, customerHistoryHref, parseCustomerHistoryPage } from "@/lib/customer-detail";

describe("pagination de l'historique client", () => {
  it("utilise 50 écritures par page et une première page sûre", () => {
    expect(CUSTOMER_HISTORY_PAGE_SIZE).toBe(50);
    for (const value of [undefined, "0", "-1", "1.5", "Infinity", "NaN", "1 OR 1=1"]) {
      expect(parseCustomerHistoryPage(value)).toBe(1);
    }
  });

  it("borne le numéro et construit un lien sans token carte", () => {
    expect(parseCustomerHistoryPage(["3", "4"])).toBe(3);
    expect(parseCustomerHistoryPage("10001")).toBe(10_000);
    expect(customerHistoryHref("customer-id", 2)).toBe("/dashboard/clients/customer-id?page=2");
    expect(customerHistoryHref("customer-id", 1)).toBe("/dashboard/clients/customer-id");
  });
});
