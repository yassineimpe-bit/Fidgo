/**
 * Délai minimal entre deux crédits sur une même carte.
 *
 * Retour terrain du 25/09/2026 : 2 minutes laissaient passer des doubles
 * passages en caisse. Les NOUVEAUX programmes démarrent à 10 minutes ; les
 * programmes existants gardent la valeur choisie par le commerce (aucune
 * migration ne la réécrit) et chaque commerce reste libre de la changer.
 */
export const DEFAULT_COOLDOWN_SECONDS = 600;
export const MAX_COOLDOWN_SECONDS = 86_400;

/** Préréglages proposés dans le formulaire programme (en secondes). */
export const COOLDOWN_PRESETS = [120, 300, 600, 900] as const;

/**
 * Motif système du dépassement de cooldown « nouvel achat » : aucune donnée
 * personnelle, lisible tel quel dans l'audit (`CARD_ADJUSTED`).
 */
export const NEW_PURCHASE_REASON = "NEW_PURCHASE_CONFIRMED";

/** « 10 min », « 1 min 30 s », « 45 s », « aucun délai ». */
export function formatCooldown(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total === 0) return "aucun délai";
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes === 0) return `${rest} s`;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

/** Compte à rebours affiché au scanner : « 9 min 05 s », « 42 s ». */
export function formatRemaining(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return minutes > 0 ? `${minutes} min ${String(rest).padStart(2, "0")} s` : `${rest} s`;
}

/** Secondes restantes avant qu'un crédit normal soit accepté (0 si aucune). */
export function cooldownRemainingSeconds(lastEarnAt: Date | string | null | undefined, cooldownSeconds: number, now = Date.now()): number {
  if (!lastEarnAt || !(cooldownSeconds > 0)) return 0;
  const last = new Date(lastEarnAt).getTime();
  if (!Number.isFinite(last)) return 0;
  const remainingMs = cooldownSeconds * 1000 - (now - last);
  return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
}
