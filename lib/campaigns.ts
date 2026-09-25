/**
 * Campagnes e-mail du commerce : validation des saisies et règles anti-spam.
 * Seuls les clients ayant eux-mêmes accepté les offres, avec une adresse
 * e-mail et une carte active, peuvent être destinataires.
 */

export type CampaignKind = "promotion" | "inactive_reminder";
export type CampaignSegment = "all" | "active" | "inactive" | "reward_available";

export const CAMPAIGN_SUBJECT_MAX = 120;
export const CAMPAIGN_MESSAGE_MAX = 2000;
/** Au plus 2 campagnes par commerce sur 7 jours glissants. */
export const CAMPAIGNS_PER_WEEK = 2;
/** Un client reçoit au plus un e-mail promotionnel tous les 7 jours, tous envois confondus. */
export const CUSTOMER_COOLDOWN_DAYS = 7;
/** Plafond de destinataires par campagne pendant la phase pilote. */
export const CAMPAIGN_MAX_RECIPIENTS = 2000;
/** Fenêtre « client actif » : un passage crédité dans les 30 derniers jours. */
export const ACTIVE_WINDOW_DAYS = 30;
export const INACTIVE_DAYS = [30, 60, 90] as const;
/** Destinataires traités par appel d'envoi (reste sous le délai d'une fonction serverless). */
export const CAMPAIGN_BATCH_SIZE = 25;
/** Un lot réservé mais non terminé redevient disponible après ce délai. */
export const CAMPAIGN_CLAIM_LEASE_SECONDS = 120;

export const CAMPAIGN_KIND_LABELS: Record<CampaignKind, string> = {
  promotion: "Campagne promotionnelle",
  inactive_reminder: "Relance clients inactifs",
};

export function segmentLabel(segment: CampaignSegment, inactiveDays: number | null): string {
  if (segment === "all") return "Tous les clients abonnés";
  if (segment === "active") return `Clients venus ces ${ACTIVE_WINDOW_DAYS} derniers jours`;
  if (segment === "reward_available") return "Clients avec une récompense disponible";
  return `Clients sans visite depuis ${inactiveDays ?? "?"} jours`;
}

export type CampaignAudience = { segment: CampaignSegment; inactiveDays: number | null };
export type CampaignInput = CampaignAudience & { kind: CampaignKind; subject: string; message: string; idempotencyKey: string };

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string; field?: string };

// Caractères de contrôle, sauf retour à la ligne et tabulation dans le message.
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,80}$/;

export function parseAudience(body: unknown): ParseResult<CampaignAudience> {
  const input = (body ?? {}) as Record<string, unknown>;
  const segment = input.segment;
  if (segment !== "all" && segment !== "active" && segment !== "inactive" && segment !== "reward_available") {
    return { ok: false, error: "INVALID_FIELD", field: "segment" };
  }
  if (segment !== "inactive") return { ok: true, value: { segment, inactiveDays: null } };
  const days = Number(input.inactiveDays);
  if (!(INACTIVE_DAYS as readonly number[]).includes(days)) return { ok: false, error: "INVALID_FIELD", field: "inactiveDays" };
  return { ok: true, value: { segment, inactiveDays: days } };
}

export function parseCampaignInput(body: unknown): ParseResult<CampaignInput> {
  const input = (body ?? {}) as Record<string, unknown>;
  const kind = input.kind;
  if (kind !== "promotion" && kind !== "inactive_reminder") return { ok: false, error: "INVALID_FIELD", field: "kind" };
  const audience = parseAudience(kind === "inactive_reminder" ? { ...input, segment: "inactive" } : input);
  if (!audience.ok) return audience;
  if (kind === "promotion" && audience.value.segment === "inactive") return { ok: false, error: "INVALID_FIELD", field: "segment" };

  const subject = typeof input.subject === "string" ? input.subject.replace(/\s+/g, " ").trim() : "";
  if (!subject || subject.length > CAMPAIGN_SUBJECT_MAX || CONTROL.test(subject)) return { ok: false, error: "INVALID_FIELD", field: "subject" };
  const message = typeof input.message === "string" ? input.message.replace(/\r\n?/g, "\n").trim() : "";
  if (!message || message.length > CAMPAIGN_MESSAGE_MAX || CONTROL.test(message)) return { ok: false, error: "INVALID_FIELD", field: "message" };
  const idempotencyKey = typeof input.idempotencyKey === "string" ? input.idempotencyKey : "";
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) return { ok: false, error: "INVALID_FIELD", field: "idempotencyKey" };

  return { ok: true, value: { kind, ...audience.value, subject, message, idempotencyKey } };
}

/** Date à partir de laquelle une nouvelle campagne est de nouveau possible, ou null si c'est déjà le cas. */
export function nextCampaignAllowedAt(recentCreatedAt: Date[], now = new Date()): Date | null {
  const windowStart = now.getTime() - 7 * 24 * 3600 * 1000;
  const inWindow = recentCreatedAt.map((date) => date.getTime()).filter((time) => time > windowStart).sort((a, b) => a - b);
  if (inWindow.length < CAMPAIGNS_PER_WEEK) return null;
  return new Date(inWindow[inWindow.length - CAMPAIGNS_PER_WEEK] + 7 * 24 * 3600 * 1000);
}

export function isMissingCampaignSchema(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "";
  // 42703 : colonne absente (migration 027 non appliquée).
  return code === "42703" || code === "42P01";
}
