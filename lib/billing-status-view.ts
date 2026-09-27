export type BillingStatusInput = {
  status: string;
  plan: string;
  trialEndsAt?: Date | string | null;
  currentPeriodEnd?: Date | string | null;
  cancelAtPeriodEnd?: boolean | null;
  hasPortal: boolean;
  billingConfigured: boolean;
};

export type BillingStatusView = {
  label: string;
  tone: "success" | "warning" | "neutral";
  /** Phrase en langage courant, sans vocabulaire Stripe. */
  message: string | null;
  /** Action suggérée : choisir une offre ou ouvrir la gestion de l'abonnement. */
  action: "subscribe" | "portal" | null;
};

const DAY_MS = 86_400_000;

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function frenchDate(date: Date) {
  return date.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });
}

/**
 * Traduit l'état stocké de l'abonnement en message lisible. Ne décide d'aucune
 * règle (délai de grâce, suspension) : il décrit seulement l'état existant.
 */
export function billingStatusView(input: BillingStatusInput, now = new Date()): BillingStatusView {
  const trialEnd = toDate(input.trialEndsAt);
  const periodEnd = toDate(input.currentPeriodEnd);
  const subscribeAction = input.billingConfigured ? "subscribe" : null;
  const portalAction = input.hasPortal && input.billingConfigured ? "portal" : null;

  switch (input.status) {
    case "active": {
      if (input.cancelAtPeriodEnd) {
        return {
          label: "Résiliation programmée",
          tone: "warning",
          message: periodEnd
            ? `L’abonnement reste actif jusqu’au ${frenchDate(periodEnd)}, puis il s’arrêtera. Tu peux annuler la résiliation d’ici là.`
            : "L’abonnement s’arrêtera à la fin de la période en cours. Tu peux annuler la résiliation d’ici là.",
          action: portalAction,
        };
      }
      return {
        label: "Actif",
        tone: "success",
        message: periodEnd ? `Prochain renouvellement le ${frenchDate(periodEnd)}.` : null,
        action: portalAction,
      };
    }
    case "past_due":
      return {
        label: "Paiement en retard",
        tone: "warning",
        message: "Le dernier paiement n’a pas pu être encaissé. Mets à jour ton moyen de paiement pour régulariser.",
        action: portalAction,
      };
    case "unpaid":
      return {
        label: "Impayé",
        tone: "warning",
        message: "Le paiement de l’abonnement n’a pas abouti. Mets à jour ton moyen de paiement pour régulariser l’abonnement.",
        action: portalAction,
      };
    case "canceled":
      return {
        label: "Résilié",
        tone: "neutral",
        message: "L’abonnement est arrêté. Tu peux choisir une nouvelle offre à tout moment.",
        action: subscribeAction,
      };
    default: {
      if (!trialEnd) {
        return { label: "Pilote gratuit", tone: "neutral", message: null, action: subscribeAction };
      }
      const daysLeft = Math.ceil((trialEnd.getTime() - now.getTime()) / DAY_MS);
      if (daysLeft <= 0) {
        return {
          label: "Essai terminé",
          tone: "warning",
          message: `La période d’essai s’est terminée le ${frenchDate(trialEnd)}. Choisis une offre pour passer à l’abonnement.`,
          action: subscribeAction,
        };
      }
      return {
        label: "Pilote gratuit",
        tone: "neutral",
        message: daysLeft === 1
          ? `Dernier jour d’essai (jusqu’au ${frenchDate(trialEnd)}).`
          : `${daysLeft} jours d’essai restants (jusqu’au ${frenchDate(trialEnd)}).`,
        action: subscribeAction,
      };
    }
  }
}
