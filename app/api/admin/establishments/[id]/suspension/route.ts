import { sql } from "@/lib/db";
import { withApiErrorHandling } from "@/lib/observability";
import { getPlatformAdmin, isUuid, parseSuspensionReason, recordPlatformAudit } from "@/lib/platform-admin";
import { enforceRateLimit } from "@/lib/rate-limit";
import { PRIVATE_HEADERS, rejectCrossOrigin } from "@/lib/security";

type Outcome = { status: number; body: Record<string, string> };

const NOT_FOUND: Outcome = { status: 404, body: { error: "NOT_FOUND" } };

/**
 * Suspension plateforme réversible : le statut 'suspended' coupe sessions
 * staff, page d'inscription, carte client, scan et récupération (tous filtrent
 * sur e.status='active'). Cartes, passes Wallet et comptes ne sont pas
 * touchés, pour permettre une réactivation sans réémission. token_version est
 * incrémenté : un JWT volé avant la suspension ne redevient pas valide après.
 */
async function handlePost(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const originError = rejectCrossOrigin(req);
  if (originError) return originError;
  const admin = await getPlatformAdmin();
  if (!admin) return Response.json(NOT_FOUND.body, { status: 404, headers: PRIVATE_HEADERS });
  const limited = await enforceRateLimit(req, `platform-admin-suspension:${admin.staffId}`, 20, 60 * 60);
  if (limited) return limited;

  const { id } = await ctx.params;
  if (!isUuid(id)) return Response.json(NOT_FOUND.body, { status: 404, headers: PRIVATE_HEADERS });

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const action = body?.action;
  const reason = parseSuspensionReason(body?.reason);
  const confirmationSlug = typeof body?.confirmationSlug === "string" ? body.confirmationSlug.trim() : "";
  if ((action !== "suspend" && action !== "reactivate") || !reason || !confirmationSlug) {
    return Response.json({ error: "INVALID_INPUT" }, { status: 400, headers: PRIVATE_HEADERS });
  }

  const outcome = await sql.begin(async (tx): Promise<Outcome> => {
    const [establishment] = await tx`
      select id, slug, status, platform_suspended_at from establishments where id=${id} for update
    `;
    if (!establishment) return NOT_FOUND;
    if (String(establishment.slug) !== confirmationSlug) return { status: 409, body: { error: "CONFIRMATION_MISMATCH" } };

    if (action === "suspend") {
      if (String(establishment.id) === admin.establishmentId) return { status: 409, body: { error: "CANNOT_SUSPEND_OWN_ESTABLISHMENT" } };
      if (establishment.status !== "active") return { status: 409, body: { error: "NOT_ACTIVE" } };
      await tx`
        update establishments
        set status='suspended', platform_suspended_at=now(), platform_suspension_reason=${reason}, updated_at=now()
        where id=${id}
      `;
      await tx`
        update staff_users set token_version=token_version+1, updated_at=now() where establishment_id=${id}
      `;
      await tx`
        update password_reset_tokens set used_at=coalesce(used_at,now())
        where staff_user_id in (select s.id from staff_users s where s.establishment_id=${id})
      `;
    } else {
      if (establishment.status !== "suspended" || !establishment.platform_suspended_at) {
        return { status: 409, body: { error: "NOT_PLATFORM_SUSPENDED" } };
      }
      await tx`
        update establishments
        set status='active', platform_suspended_at=null, platform_suspension_reason=null, updated_at=now()
        where id=${id}
      `;
    }

    const auditAction = action === "suspend" ? "PLATFORM_SUSPEND" : "PLATFORM_REACTIVATE";
    await tx`
      insert into audit_logs(establishment_id, staff_user_id, action, entity_type, entity_id, metadata)
      values(${id}, null, ${auditAction}, 'establishment', ${id}, ${tx.json({ byPlatform: true })})
    `;
    await recordPlatformAudit(admin, {
      action: auditAction,
      targetType: "establishment",
      targetId: id,
      reason,
    }, tx);
    return { status: 200, body: { ok: "true", status: action === "suspend" ? "suspended" : "active" } };
  });

  return Response.json(outcome.body, { status: outcome.status, headers: PRIVATE_HEADERS });
}

export const POST = withApiErrorHandling("PLATFORM_ADMIN_SUSPENSION", handlePost);
