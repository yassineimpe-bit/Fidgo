/**
 * Offres Retiko, sans dépendance serveur : partagées par la facturation
 * (Stripe) et le site public (section Prix), pour qu'un tarif affiché ne
 * puisse pas diverger du tarif facturé.
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
} as const;
