import type { StaffRole } from "@/lib/loyalty";

/** Regroupement du menu mobile par usage ; n'influe ni sur les routes ni sur les droits. */
export type AppNavGroup = "daily" | "setup" | "account";

type AppNavLink = {
  href: string;
  label: string;
  keepMobile?: boolean;
  group: AppNavGroup;
  roles: StaffRole[];
};

const BACKOFFICE: StaffRole[] = ["OWNER", "MANAGER", "VIEWER"];
const MANAGEMENT: StaffRole[] = ["OWNER", "MANAGER"];
const ALL: StaffRole[] = ["OWNER", "MANAGER", "EMPLOYEE", "VIEWER"];

export const APP_NAV_LINKS: AppNavLink[] = [
  { href: "/dashboard", label: "Dashboard", group: "daily", roles: BACKOFFICE },
  { href: "/dashboard/analytics", label: "Analytics", group: "daily", roles: BACKOFFICE },
  { href: "/s", label: "Scanner", keepMobile: true, group: "daily", roles: ["OWNER", "MANAGER", "EMPLOYEE"] },
  { href: "/dashboard/clients", label: "Clients", group: "daily", roles: BACKOFFICE },
  { href: "/dashboard/program", label: "Programme", group: "setup", roles: MANAGEMENT },
  { href: "/dashboard/transactions", label: "Transactions", group: "daily", roles: BACKOFFICE },
  { href: "/dashboard/campaigns", label: "Campagnes", group: "daily", roles: BACKOFFICE },
  { href: "/dashboard/employees", label: "Équipe", group: "setup", roles: MANAGEMENT },
  { href: "/dashboard/settings", label: "Commerce", group: "setup", roles: MANAGEMENT },
  { href: "/dashboard/security", label: "Sécurité", group: "account", roles: ALL },
  { href: "/dashboard/billing", label: "Facturation", group: "account", roles: ["OWNER"] },
  { href: "/dashboard/wallet", label: "Wallet", group: "account", roles: MANAGEMENT },
  { href: "/dashboard/poster", label: "Affiche QR", group: "account", roles: MANAGEMENT },
];

export const APP_NAV_GROUPS: { id: AppNavGroup; label: string; order: string[] }[] = [
  { id: "daily", label: "Au quotidien", order: ["/dashboard", "/dashboard/clients", "/dashboard/transactions", "/dashboard/analytics", "/dashboard/campaigns"] },
  { id: "setup", label: "Configuration", order: ["/dashboard/program", "/dashboard/settings", "/dashboard/employees"] },
  { id: "account", label: "Compte", order: ["/dashboard/wallet", "/dashboard/billing", "/dashboard/poster", "/dashboard/security"] },
];

type GroupableLink = { href: string; label: string; keepMobile?: boolean; group: AppNavGroup };

/**
 * Sections du menu mobile : liens déjà filtrés par rôle, hors actions gardées
 * dans l'en-tête (Scanner). Une section sans lien pour ce rôle disparaît.
 */
export function groupMobileNavLinks<T extends GroupableLink>(links: T[]): { id: AppNavGroup; label: string; links: T[] }[] {
  const menu = links.filter((link) => !link.keepMobile);
  return APP_NAV_GROUPS.map((group) => {
    const rank = (link: T) => {
      const index = group.order.indexOf(link.href);
      return index === -1 ? group.order.length : index;
    };
    return {
      id: group.id,
      label: group.label,
      links: menu.filter((link) => link.group === group.id).sort((a, b) => rank(a) - rank(b)),
    };
  }).filter((group) => group.links.length > 0);
}
