export const ONBOARDING_STEPS = ["Commerce", "Programme", "Équipe", "QR d’inscription"] as const;

export function onboardingPageStep(savedStep: number, requestedStep?: string): number {
  const requested = Number(requestedStep);
  return Number.isInteger(requested) && requested >= 1 && requested <= Math.min(savedStep, 4)
    ? requested
    : savedStep;
}
