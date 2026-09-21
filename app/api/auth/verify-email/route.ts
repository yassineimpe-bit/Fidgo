import { sql } from "@/lib/db";
import { hashEmailVerificationToken, isValidEmailVerificationToken } from "@/lib/email-verification";
import { withApiErrorHandling } from "@/lib/observability";
import { consumeRateLimit } from "@/lib/rate-limit";
import { PRIVATE_HEADERS, rejectCrossOrigin, requestIp } from "@/lib/security";

async function handlePost(req: Request) {
  const originError = rejectCrossOrigin(req);
  if (originError) return originError;

  const limited = await consumeRateLimit(`email-verify-consume:${requestIp(req)}`, 30, 60 * 60);
  if (!limited.allowed) {
    return Response.json({ error: "TOO_MANY_ATTEMPTS" }, { status: 429, headers: PRIVATE_HEADERS });
  }

  const body = await req.json().catch(() => ({}));
  const token = String(body.token || "").trim();
  if (!isValidEmailVerificationToken(token)) {
    return Response.json({ error: "INVALID_OR_EXPIRED_LINK" }, { status: 400, headers: PRIVATE_HEADERS });
  }

  const tokenHash = hashEmailVerificationToken(token);

  try {
    const result = await sql.begin(async (tx) => {
      const [row] = await tx`
        select v.id, v.staff_user_id, s.establishment_id
        from email_verification_tokens v
        join staff_users s on s.id = v.staff_user_id
        join establishments e on e.id = s.establishment_id
        where v.token_hash = ${tokenHash}
          and v.used_at is null
          and v.expires_at > now()
          and s.active = true
          and e.status = 'active'
        limit 1
        for update of v, s
      `;
      if (!row) return null;

      const staffId = String(row.staff_user_id);
      const establishmentId = String(row.establishment_id);

      await tx`
        update staff_users
        set email_verified_at = coalesce(email_verified_at, now()), updated_at = now()
        where id = ${staffId}
      `;
      await tx`
        update email_verification_tokens
        set used_at = now()
        where staff_user_id = ${staffId} and used_at is null
      `;
      await tx`
        insert into audit_logs(establishment_id, staff_user_id, action, entity_type, entity_id)
        values(${establishmentId}, ${staffId}, 'EMAIL_VERIFIED', 'staff_user', ${staffId})
      `;
      return { ok: true };
    });

    if (!result) {
      return Response.json({ error: "INVALID_OR_EXPIRED_LINK" }, { status: 400, headers: PRIVATE_HEADERS });
    }

    return Response.json({ ok: true }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
    if (code === "42P01" || code === "42703") {
      return Response.json({ error: "EMAIL_VERIFICATION_UNAVAILABLE" }, { status: 503, headers: PRIVATE_HEADERS });
    }
    throw error;
  }
}

export const POST = withApiErrorHandling("EMAIL_VERIFICATION_CONSUME", handlePost);
