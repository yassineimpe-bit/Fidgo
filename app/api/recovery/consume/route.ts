import { hashCardRecoveryToken, isValidCardRecoveryToken } from "@/lib/card-recovery";
import { sql } from "@/lib/db";
import { withApiErrorHandling } from "@/lib/observability";
import { consumeRateLimit } from "@/lib/rate-limit";
import { PRIVATE_HEADERS, rejectCrossOrigin, requestIp } from "@/lib/security";

async function handlePost(req: Request) {
  const originError = rejectCrossOrigin(req);
  if (originError) return originError;

  const limited = await consumeRateLimit(`recovery-consume:${requestIp(req)}`, 30, 60 * 60);
  if (!limited.allowed) {
    return Response.json({ error: "TOO_MANY_ATTEMPTS" }, { status: 429, headers: PRIVATE_HEADERS });
  }

  const body = await req.json().catch(() => ({}));
  const token = String(body.token || "").trim();
  if (!isValidCardRecoveryToken(token)) {
    return Response.json({ error: "INVALID_OR_EXPIRED_LINK" }, { status: 400, headers: PRIVATE_HEADERS });
  }

  const tokenHash = hashCardRecoveryToken(token);
  try {
    const recovered = await sql.begin(async (tx) => {
      const [row] = await tx`
        select r.id, r.establishment_id, r.card_id, c.token as card_token, e.slug
        from card_recovery_tokens r
        join cards c on c.id = r.card_id
        join customers u on u.id = c.customer_id
        join establishments e on e.id = r.establishment_id
        where r.token_hash = ${tokenHash}
          and r.used_at is null
          and r.expires_at > now()
          and c.active = true
          and u.deleted_at is null
          and e.status = 'active'
        limit 1
        for update of r
      `;
      if (!row) return null;

      await tx`update card_recovery_tokens set used_at = now() where id = ${row.id}`;
      await tx`
        insert into audit_logs(establishment_id, action, entity_type, entity_id)
        values(${row.establishment_id}, 'CARD_RECOVERY_CONSUMED', 'card', ${String(row.card_id)})
      `;
      return { token: String(row.card_token), slug: String(row.slug) };
    });

    if (!recovered) {
      return Response.json({ error: "INVALID_OR_EXPIRED_LINK" }, { status: 400, headers: PRIVATE_HEADERS });
    }
    return Response.json(recovered, { headers: PRIVATE_HEADERS });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
    if (code === "42P01") {
      return Response.json({ error: "RECOVERY_UNAVAILABLE" }, { status: 503, headers: PRIVATE_HEADERS });
    }
    throw error;
  }
}

export const POST = withApiErrorHandling("RECOVERY_CONSUME", handlePost);
