import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { sanitizeAuditText } from "@/lib/observability";

export type PlatformAdmin = { staffId: string; email: string; establishmentId: string };

/**
 * Accès super-admin : session staff valide ET ligne dans platform_admins.
 * Échoue fermé : toute erreur (migration absente, base indisponible) vaut
 * « pas admin », et les appelants répondent 404 pour ne pas révéler la zone.
 */
export async function getPlatformAdmin(): Promise<PlatformAdmin | null> {
  try {
    const session = await getSession();
    if (!session) return null;
    const [row] = await sql`
      select 1 from platform_admins where staff_user_id=${session.staffId} limit 1
    `;
    if (!row) return null;
    return { staffId: session.staffId, email: session.email, establishmentId: session.establishmentId };
  } catch {
    return null;
  }
}

/**
 * À appeler dans CHAQUE page /admin, pas seulement dans le layout : lors d'une
 * navigation client, Next ne réévalue pas le layout, seulement la page.
 * La consultation est journalisée avant tout affichage de données.
 */
export async function requirePlatformAdmin(view: string, metadata: PlatformAuditEntry["metadata"] = {}, target?: { type: string; id: string }): Promise<PlatformAdmin> {
  const admin = await getPlatformAdmin();
  if (!admin) notFound();
  await recordPlatformAudit(admin, {
    action: "ADMIN_VIEW",
    targetType: target?.type ?? null,
    targetId: target?.id ?? null,
    metadata: { view, ...metadata },
  });
  return admin;
}

export type PlatformAuditEntry = {
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  reason?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
};

type SqlLike = typeof sql;

export async function recordPlatformAudit(admin: PlatformAdmin, entry: PlatformAuditEntry, tx: SqlLike = sql) {
  await tx`
    insert into platform_admin_audit(admin_staff_user_id,admin_email,action,target_type,target_id,reason,metadata)
    values(
      ${admin.staffId},${admin.email},${entry.action},
      ${entry.targetType ?? null},${entry.targetId ?? null},${entry.reason ?? null},
      ${tx.json(entry.metadata ?? {})}
    )
  `;
}

export const SUSPENSION_REASON_MIN = 10;
export const SUSPENSION_REASON_MAX = 500;

/** Motif obligatoire, texte brut, sans balises : il est relu dans l'interface admin. */
export function parseSuspensionReason(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const reason = sanitizeAuditText(input.replace(/\s+/g, " ").trim(), SUSPENSION_REASON_MAX);
  if (!reason || reason.length < SUSPENSION_REASON_MIN || /[<>]/.test(reason)) return null;
  return reason;
}

export const ADMIN_PAGE_SIZE = 50;

export function parseAdminSearch(input: { q?: string | string[]; page?: string | string[] }) {
  const rawQ = Array.isArray(input.q) ? input.q[0] : input.q;
  const rawPage = Array.isArray(input.page) ? input.page[0] : input.page;
  const q = typeof rawQ === "string" ? rawQ.trim().slice(0, 120) : "";
  const pageNumber = Number(rawPage);
  const page = Number.isInteger(pageNumber) && pageNumber >= 1 && pageNumber <= 10_000 ? pageNumber : 1;
  return { q, page, offset: (page - 1) * ADMIN_PAGE_SIZE };
}

/** Échappe %, _ et \ pour une recherche `like` littérale. */
export function likePattern(q: string) {
  return `%${q.toLowerCase().replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

export function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
