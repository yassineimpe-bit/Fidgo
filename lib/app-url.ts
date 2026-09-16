export type AppUrlEnv = Record<string, string | undefined>;

const RETIKO_PRODUCTION_ORIGIN = "https://retiko.fr";

function normalizeAppUrl(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) return "";
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(candidate).origin;
  } catch {
    return "";
  }
}

export function getAppUrl(env: AppUrlEnv = process.env) {
  const explicit = normalizeAppUrl(env.NEXT_PUBLIC_APP_URL);

  // Le domaine Retiko est définitif. En Production Vercel, les URL publiques
  // générées doivent rester sur retiko.fr même si une variable a été oubliée
  // ou pointe encore vers l'ancien alias technique. `env:check` signale la
  // mauvaise configuration ; ce garde-fou évite malgré tout d'imprimer ou
  // d'envoyer un lien Vercel à un vrai client.
  if (env.VERCEL_ENV === "production") return RETIKO_PRODUCTION_ORIGIN;

  if (explicit) return explicit;

  return normalizeAppUrl(env.VERCEL_PROJECT_PRODUCTION_URL)
    || normalizeAppUrl(env.VERCEL_URL);
}
