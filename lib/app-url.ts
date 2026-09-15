export type AppUrlEnv = Record<string, string | undefined>;

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
  return normalizeAppUrl(env.NEXT_PUBLIC_APP_URL)
    || normalizeAppUrl(env.VERCEL_PROJECT_PRODUCTION_URL)
    || normalizeAppUrl(env.VERCEL_URL);
}
