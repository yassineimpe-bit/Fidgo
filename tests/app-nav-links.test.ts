import { describe, expect, it } from "vitest";
import { APP_NAV_GROUPS, APP_NAV_LINKS, groupMobileNavLinks } from "@/lib/app-nav-links";
import type { StaffRole } from "@/lib/loyalty";

function menuFor(role: StaffRole) {
  return groupMobileNavLinks(APP_NAV_LINKS.filter((link) => link.roles.includes(role)))
    .map((group) => [group.label, group.links.map((link) => link.label)]);
}

describe("menu mobile groupé par usage", () => {
  it("OWNER : trois sections dans l'ordre d'usage, Scanner reste hors menu", () => {
    expect(menuFor("OWNER")).toEqual([
      ["Au quotidien", ["Dashboard", "Clients", "Transactions", "Analytics", "Campagnes"]],
      ["Configuration", ["Programme", "Commerce", "Équipe"]],
      ["Compte", ["Wallet", "Facturation", "Affiche QR", "Sécurité"]],
    ]);
  });

  it("MANAGER : mêmes sections, sans Facturation réservée au propriétaire", () => {
    expect(menuFor("MANAGER")).toEqual([
      ["Au quotidien", ["Dashboard", "Clients", "Transactions", "Analytics", "Campagnes"]],
      ["Configuration", ["Programme", "Commerce", "Équipe"]],
      ["Compte", ["Wallet", "Affiche QR", "Sécurité"]],
    ]);
  });

  it("EMPLOYEE et VIEWER : une section vide disparaît", () => {
    expect(menuFor("EMPLOYEE")).toEqual([["Compte", ["Sécurité"]]]);
    expect(menuFor("VIEWER")).toEqual([
      ["Au quotidien", ["Dashboard", "Clients", "Transactions", "Analytics", "Campagnes"]],
      ["Compte", ["Sécurité"]],
    ]);
  });

  it("chaque lien du menu appartient à une section et y est ordonné", () => {
    for (const link of APP_NAV_LINKS.filter((item) => !item.keepMobile)) {
      const group = APP_NAV_GROUPS.find((item) => item.id === link.group);
      expect(group?.order, link.href).toContain(link.href);
    }
  });

  it("le regroupement ne change ni les routes ni les droits", () => {
    expect(Object.fromEntries(APP_NAV_LINKS.map((link) => [link.href, link.roles]))).toEqual({
      "/dashboard": ["OWNER", "MANAGER", "VIEWER"],
      "/dashboard/analytics": ["OWNER", "MANAGER", "VIEWER"],
      "/s": ["OWNER", "MANAGER", "EMPLOYEE"],
      "/dashboard/clients": ["OWNER", "MANAGER", "VIEWER"],
      "/dashboard/program": ["OWNER", "MANAGER"],
      "/dashboard/transactions": ["OWNER", "MANAGER", "VIEWER"],
      "/dashboard/campaigns": ["OWNER", "MANAGER", "VIEWER"],
      "/dashboard/employees": ["OWNER", "MANAGER"],
      "/dashboard/settings": ["OWNER", "MANAGER"],
      "/dashboard/security": ["OWNER", "MANAGER", "EMPLOYEE", "VIEWER"],
      "/dashboard/billing": ["OWNER"],
      "/dashboard/wallet": ["OWNER", "MANAGER"],
      "/dashboard/poster": ["OWNER", "MANAGER"],
    });
  });
});
