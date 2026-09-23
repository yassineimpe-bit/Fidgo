export const ACTIVITY_PERIODS = [
  { value: "7", label: "7 jours", days: 7 },
  { value: "30", label: "30 jours", days: 30 },
  { value: "90", label: "90 jours", days: 90 },
] as const;

export type ActivityPeriod = typeof ACTIVITY_PERIODS[number]["value"];

export function parseActivityFilters(input: {
  q?: string | string[];
  period?: string | string[];
  page?: string | string[];
}) {
  const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
  const q = (first(input.q) || "").trim().slice(0, 120);
  const rawPeriod = first(input.period) || "30";
  const period = ACTIVITY_PERIODS.find((item) => item.value === rawPeriod) ?? ACTIVITY_PERIODS[1];
  const rawPage = Number(first(input.page) || "1");
  const page = Number.isInteger(rawPage) && rawPage > 0 ? Math.min(rawPage, 10_000) : 1;
  const limit = 50;
  return { q, period, page, limit, offset: (page - 1) * limit };
}

const ACTION_LABELS: Record<string, string> = {
  STAFF_CREATE: "Employé créé",
  STAFF_ACCESS_UPDATE: "Accès employé modifié",
  STAFF_UPDATE: "Rôle ou accès équipe modifié",
  PASSWORD_RESET_EMAIL_SENT: "Email de réinitialisation envoyé",
  PASSWORD_RESET_EMAIL_FAILED: "Échec email de réinitialisation",
  PASSWORD_RESET_COMPLETED: "Mot de passe réinitialisé",
  PASSWORD_CHANGED: "Mot de passe modifié",
  CUSTOMER_ERASE: "Client effacé",
  ESTABLISHMENT_SUSPEND: "Commerce suspendu",
  PLATFORM_SUSPEND: "Commerce suspendu par Retiko",
  PLATFORM_REACTIVATE: "Commerce réactivé par Retiko",
};

export function activityActionLabel(action: string) {
  return ACTION_LABELS[action] || action
    .toLowerCase()
    .split("_")
    .map((part) => part ? part[0].toUpperCase() + part.slice(1) : part)
    .join(" ");
}
