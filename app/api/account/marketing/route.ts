import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { withApiErrorHandling } from "@/lib/observability";
import { enforceRateLimit } from "@/lib/rate-limit";
import { PRIVATE_HEADERS, rejectCrossOrigin } from "@/lib/security";

/**
 * Choix personnel de recevoir les nouveautés Retiko. Contrairement au
 * consentement d'un client final, c'est la personne concernée qui agit : elle
 * peut donc consentir comme retirer son consentement, à tout moment.
 */
async function handlePatch(req: Request) {
  const originError = rejectCrossOrigin(req);
  if (originError) return originError;
  const session = await getSession();
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401, headers: PRIVATE_HEADERS });
  const limited = await enforceRateLimit(req, `account-marketing:${session.staffId}`, 20, 60 * 60);
  if (limited) return limited;

  const body = await req.json().catch(() => null);
  if (typeof body?.marketingConsent !== "boolean") {
    return Response.json({ error: "INVALID_INPUT" }, { status: 400, headers: PRIVATE_HEADERS });
  }
  const consent: boolean = body.marketingConsent;

  const changed = await sql.begin(async (tx) => {
    const [updated] = await tx`
      update staff_users set
        marketing_consent=${consent},
        marketing_consent_at=${consent ? new Date() : null},
        updated_at=now()
      where id=${session.staffId}
        and establishment_id=${session.establishmentId}
        and marketing_consent is distinct from ${consent}
      returning id
    `;
    if (!updated) return false;
    await tx`
      insert into audit_logs(establishment_id,staff_user_id,action,entity_type,entity_id,metadata)
      values(${session.establishmentId},${session.staffId},'STAFF_MARKETING_CONSENT_UPDATED','staff_user',${session.staffId},${tx.json({ consent })})
    `;
    return true;
  });
  return Response.json({ ok: true, marketingConsent: consent, changed }, { headers: PRIVATE_HEADERS });
}

export const PATCH = withApiErrorHandling("ACCOUNT_MARKETING_UPDATE", handlePatch);
