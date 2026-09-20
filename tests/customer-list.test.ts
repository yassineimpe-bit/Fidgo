import { describe, expect, it } from "vitest";
import { CUSTOMER_PAGE_SIZE, parseCustomerListFilters } from "@/lib/customer-list";

describe("customer list filters", () => {
  it("utilise la première page par défaut", () => {
    expect(parseCustomerListFilters({})).toEqual({
      q: "",
      page: 1,
      limit: CUSTOMER_PAGE_SIZE,
      offset: 0,
    });
  });

  it("borne recherche et pagination", () => {
    const filters = parseCustomerListFilters({
      q: "x".repeat(200),
      page: "-2",
    });
    expect(filters.q).toHaveLength(120);
    expect(filters.page).toBe(1);
    expect(filters.offset).toBe(0);
  });

  it("calcule l'offset serveur", () => {
    expect(parseCustomerListFilters({ page: "3" })).toMatchObject({
      page: 3,
      offset: CUSTOMER_PAGE_SIZE * 2,
    });
  });
});
