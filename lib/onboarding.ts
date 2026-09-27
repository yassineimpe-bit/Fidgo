/**
 * Chemin critique vers le premier test : commerce, programme, QR. L'équipe
 * n'en fait plus partie (#151) : elle se crée ensuite depuis le dashboard.
 */
export const ONBOARDING_STEPS = ["Commerce", "Programme", "QR d’inscription"] as const;

/**
 * Étape enregistrée en base (1 à 5) → étape affichée (1 à 3). Les valeurs 3
 * et 4 mènent toutes deux au QR : 4 est l'étape QR de l'ancien parcours
 * (après « Équipe »), conservée pour les onboardings commencés avant.
 */
export function onboardingDisplayStep(savedStep: number): number {
  return Math.max(1, Math.min(savedStep, ONBOARDING_STEPS.length));
}

export function onboardingPageStep(savedStep: number, requestedStep?: string): number {
  const reached = onboardingDisplayStep(savedStep);
  const requested = Number(requestedStep);
  return Number.isInteger(requested) && requested >= 1 && requested <= reached ? requested : reached;
}
