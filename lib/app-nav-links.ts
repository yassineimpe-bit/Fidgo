import type { StaffRole } from "@/lib/loyalty";

type AppNavLink = {
  href: string;
  label: string;
  keepMobile?: boolean;
  roles: StaffRole[];
};

const BACKOFFICE: StaffRole[] = ["OWNER", "MANAGER", "VIEWER"];
const MANAGEMENT: StaffRole[] = ["OWNER", "MANAGER"];
const ALL: StaffRole[] = ["OWNER", "MANAGER", "EMPLOYEE", "VIEWER"];

export const APP_NAV_LINKS: AppNavLink[] = [
  { href: "/dashboard", label: "Dashboard", roles: BACKOFFICE },
  { href: "/dashboard/analytics", label: "Analytics", roles: BACKOFFICE },
  { href: "/s", label: "Scanner", keepMobile: true, roles: ["OWNER", "MANAGER", "EMPLOYEE"] },
  { href: "/dashboard/clients", label: "Clients", roles: BACKOFFICE },
  { href: "/dashboard/program", label: "Programme", roles: MANAGEMENT },
  { href: "/dashboard/transactions", label: "Transactions", roles: BACKOFFICE },
  { href: "/dashboard/employees", label: "Équipe", roles: MANAGEMENT },
  { href: "/dashboard/settings", label: "Commerce", roles: MANAGEMENT },
  { href: "/dashboard/security", label: "Sécurité", roles: ALL },
  { href: "/dashboard/billing", label: "Facturation", roles: ["OWNER"] },
  { href: "/dashboard/wallet", label: "Wallet", roles: MANAGEMENT },
  { href: "/dashboard/poster", label: "Affiche QR", roles: MANAGEMENT },
];
