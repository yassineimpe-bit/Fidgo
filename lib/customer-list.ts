export const CUSTOMER_PAGE_SIZE = 50;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function parseCustomerListFilters(input: {
  q?: string | string[];
  page?: string | string[];
}) {
  const q = (first(input.q) || "").trim().slice(0, 120);
  const rawPage = Number(first(input.page) || "1");
  const page = Number.isInteger(rawPage) && rawPage > 0 ? Math.min(rawPage, 10_000) : 1;
  return {
    q,
    page,
    limit: CUSTOMER_PAGE_SIZE,
    offset: (page - 1) * CUSTOMER_PAGE_SIZE,
  };
}
