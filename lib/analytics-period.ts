export const ANALYTICS_PERIODS = [
  { value: "7", label: "7 jours", days: 7 },
  { value: "30", label: "30 jours", days: 30 },
  { value: "90", label: "90 jours", days: 90 },
] as const;

export type AnalyticsPeriod = typeof ANALYTICS_PERIODS[number]["value"];

export function parseAnalyticsPeriod(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  return ANALYTICS_PERIODS.find((period) => period.value === raw) ?? ANALYTICS_PERIODS[1];
}
