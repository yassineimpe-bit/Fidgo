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
  if (explicit) return explicit;

  // Le domaine Retiko est définitif. En Production Vercel, ne jamais laisser
  // les QR, liens Wallet ou emails retomber sur l'alias technique du projet si
  // NEXT_PUBLIC_APP_URL a été oublié. Les previews conservent leur URL Vercel.
  if (env.VERCEL_ENV === "production") return RETIKO_PRODUCTION_ORIGIN;

  return normalizeAppUrl(env.VERCEL_PROJECT_PRODUCTION_URL)
    || normalizeAppUrl(env.VERCEL_URL);
}
