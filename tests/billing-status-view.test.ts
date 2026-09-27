import { describe, expect, it } from "vitest";
import { billingStatusView } from "@/lib/billing-status-view";

const now = new Date("2026-09-26T10:00:00Z");
const base = { plan: "PILOT", hasPortal: true, billingConfigured: true };

describe("facturation : état lisible", () => {
  it("essai : jours restants puis fin d'essai, avec l'offre en action", () => {
    expect(billingStatusView({ ...base, status: "trial", trialEndsAt: "2026-10-06T10:00:00Z" }, now))
      .toMatchObject({ label: "Pilote gratuit", tone: "neutral", message: "10 jours d’essai restants (jusqu’au 06/10/2026).", action: "subscribe" });
    expect(billingStatusView({ ...base, status: "trial", trialEndsAt: "2026-09-27T09:00:00Z" }, now).message)
      .toBe("Dernier jour d’essai (jusqu’au 27/09/2026).");
    expect(billingStatusView({ ...base, status: "trial", trialEndsAt: "2026-09-20T10:00:00Z" }, now))
      .toMatchObject({ label: "Essai terminé", tone: "warning", action: "subscribe" });
    expect(billingStatusView({ ...base, status: "trial" }, now)).toMatchObject({ label: "Pilote gratuit", message: null });
  });

  it("paiement échoué : message clair et gestion de l'abonnement, sans jargon", () => {
    const pastDue = billingStatusView({ ...base, status: "past_due" }, now);
    expect(pastDue).toMatchObject({ label: "Paiement en retard", tone: "warning", action: "portal" });
    expect(pastDue.message).not.toMatch(/stripe|invoice|dunning/i);
    expect(billingStatusView({ ...base, status: "unpaid" }, now)).toMatchObject({ label: "Impayé", tone: "warning", action: "portal" });
    // Sans client de facturation, aucune action factice.
    expect(billingStatusView({ ...base, hasPortal: false, status: "past_due" }, now).action).toBeNull();
  });

  it("actif, résiliation programmée, résilié", () => {
    expect(billingStatusView({ ...base, status: "active", currentPeriodEnd: "2026-10-26T10:00:00Z" }, now))
      .toMatchObject({ label: "Actif", tone: "success", message: "Prochain renouvellement le 26/10/2026." });
    expect(billingStatusView({ ...base, status: "active", cancelAtPeriodEnd: true, currentPeriodEnd: "2026-10-26T10:00:00Z" }, now))
      .toMatchObject({ label: "Résiliation programmée", tone: "warning", action: "portal" });
    expect(billingStatusView({ ...base, status: "canceled" }, now)).toMatchObject({ label: "Résilié", action: "subscribe" });
    expect(billingStatusView({ ...base, billingConfigured: false, status: "canceled" }, now).action).toBeNull();
  });
});
