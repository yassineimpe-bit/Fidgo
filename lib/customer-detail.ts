export const CUSTOMER_HISTORY_PAGE_SIZE = 50;

export function parseCustomerHistoryPage(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^[1-9]\d{0,4}$/.test(raw)) return 1;
  return Math.min(Number(raw), 10_000);
}

export function customerHistoryHref(customerId: string, page: number) {
  const path = `/dashboard/clients/${customerId}`;
  return page > 1 ? `${path}?page=${page}` : path;
}
