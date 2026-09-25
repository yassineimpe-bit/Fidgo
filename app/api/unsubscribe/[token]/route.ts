import { sql } from "@/lib/db";
import { withApiErrorHandling } from "@/lib/observability";
import { rateLimit } from "@/lib/rate-limit";
import { verifyUnsubscribeToken } from "@/lib/unsubscribe";

const PRIVATE_HEADERS = { "cache-control": "no-store", "referrer-policy": "no-referrer" };

/**
 * Désabonnement en un clic (RFC 8058) : les messageries envoient un POST
 * depuis leurs serveurs, sans en-tête Origin de Retiko, d'où l'absence de
 * contrôle d'origine. L'action est idempotente et ne fait que retirer un
 * consentement : aucun risque à la rejouer.
 */
async function handlePost(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const limited = await rateLimit(req, "unsubscribe", 300, 60 * 60);
  if (!limited.allowed) return Response.json({ error: "RATE_LIMITED" }, { status: 429, headers: PRIVATE_HEADERS });
  const customerId = verifyUnsubscribeToken((await params).token);
  if (!customerId) return Response.json({ error: "INVALID_LINK" }, { status: 404, headers: PRIVATE_HEADERS });

  await sql.begin(async (tx) => {
    const [withdrawn] = await tx`
      update customers set marketing_consent=false, marketing_consent_at=null, updated_at=now()
      where id=${customerId} and deleted_at is null and marketing_consent=true
      returning establishment_id
    `;
    if (withdrawn) {
      await tx`
        insert into audit_logs(establishment_id, staff_user_id, action, entity_type, entity_id, metadata)
        values(${withdrawn.establishment_id}, null, 'CUSTOMER_MARKETING_WITHDRAWN', 'customer', ${customerId}, ${tx.json({ source: "unsubscribe_link" })})
      `;
    }
  });
  return Response.json({ ok: true }, { headers: PRIVATE_HEADERS });
}

export const POST = withApiErrorHandling("UNSUBSCRIBE", handlePost);
