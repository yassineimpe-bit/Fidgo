/**
 * Offres Retiko, sans dépendance serveur : partagées par la facturation
 * (Stripe) et le site public (section Prix), pour qu'un tarif affiché ne
 * puisse pas diverger du tarif facturé.
 *
 * Deux grilles coexistent : « pilot » (tarifs de lancement) et « standard »
 * (25 € HT/mois, 250 € HT/an). `BILLING_PRICE_GRID` choisit la grille
 * proposée aux nouveaux abonnements ; chaque offre a sa propre clé et son
 * propre Price Stripe, si bien qu'un abonné conserve l'offre et le prix
 * qu'il a souscrits quand la grille change.
 */
export const BILLING_TRIAL_DAYS = 30;

export const BILLING_PLANS = {
  FLEX: {
    label: "Retiko Flex",
    priceLabel: "24,99 € HT/mois",
    billingInterval: "monthly",
    priceEnv: "STRIPE_PRICE_FLEX_MONTHLY",
    commitment: "Sans engagement",
  },
  RETIKO_12: {
    label: "Retiko 12",
    priceLabel: "19,99 € HT/mois",
    billingInterval: "monthly",
    priceEnv: "STRIPE_PRICE_RETIKO12_MONTHLY",
    commitment: "Engagement commercial de 12 mois",
  },
  ANNUAL: {
    label: "Retiko annuel",
    priceLabel: "210 € HT/an",
    billingInterval: "annual",
    priceEnv: "STRIPE_PRICE_ANNUAL",
    commitment: "Facturation annuelle",
  },
  STANDARD_MONTHLY: {
    label: "Retiko mensuel",
    priceLabel: "25 € HT/mois",
    billingInterval: "monthly",
    priceEnv: "STRIPE_PRICE_STANDARD_MONTHLY",
    commitment: "Sans engagement",
  },
  STANDARD_ANNUAL: {
    label: "Retiko annuel",
    priceLabel: "250 € HT/an",
    billingInterval: "annual",
    priceEnv: "STRIPE_PRICE_STANDARD_ANNUAL",
    commitment: "Facturation annuelle",
  },
} as const;

export type BillingPlan = keyof typeof BILLING_PLANS;

export const BILLING_PRICE_GRIDS = {
  pilot: ["FLEX", "RETIKO_12", "ANNUAL"],
  standard: ["STANDARD_MONTHLY", "STANDARD_ANNUAL"],
} as const satisfies Record<string, readonly BillingPlan[]>;

export type BillingPriceGrid = keyof typeof BILLING_PRICE_GRIDS;

/** Grille proposée aux nouveaux abonnements ; « pilot » tant que rien n'est décidé. */
export function activePriceGrid(env: Record<string, string | undefined> = process.env): BillingPriceGrid {
  return env.BILLING_PRICE_GRID === "standard" ? "standard" : "pilot";
}

/** Offres proposées à la souscription, dans l'ordre d'affichage. */
export function offeredPlans(env: Record<string, string | undefined> = process.env): readonly BillingPlan[] {
  return BILLING_PRICE_GRIDS[activePriceGrid(env)];
}
