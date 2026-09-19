import bcrypt from "bcryptjs";
import { sql } from "@/lib/db";
import { hashPasswordResetToken, isValidNewPassword, isValidPasswordResetToken } from "@/lib/password-reset";
import { withApiErrorHandling } from "@/lib/observability";
import { consumeRateLimit } from "@/lib/rate-limit";
import { PRIVATE_HEADERS, rejectCrossOrigin, requestIp } from "@/lib/security";

async function handlePost(req: Request) {
  const originError = rejectCrossOrigin(req);
  if (originError) return originError;

  const limited = await consumeRateLimit(`password-reset-consume:${requestIp(req)}`, 20, 60 * 60);
  if (!limited.allowed) {
    return Response.json({ error: "TOO_MANY_ATTEMPTS" }, { status: 429, headers: PRIVATE_HEADERS });
  }

  const body = await req.json().catch(() => ({}));
  const token = String(body.token || "").trim();
  const password = String(body.password || "");
  if (!isValidPasswordResetToken(token)) {
    return Response.json({ error: "INVALID_OR_EXPIRED_LINK" }, { status: 400, headers: PRIVATE_HEADERS });
  }
  if (!isValidNewPassword(password)) {
    return Response.json({ error: "INVALID_INPUT" }, { status: 400, headers: PRIVATE_HEADERS });
  }

  const tokenHash = hashPasswordResetToken(token);
  // Calculé avant la transaction : bcrypt est volontairement lent (coût 12),
  // le hash ne doit pas prolonger le verrou de ligne pris ci-dessous.
  const passwordHash = await bcrypt.hash(password, 12);

  try {
    const result = await sql.begin(async (tx) => {
      const [row] = await tx`
        select r.id, r.staff_user_id, s.establishment_id
        from password_reset_tokens r
        join staff_users s on s.id = r.staff_user_id
        join establishments e on e.id = s.establishment_id
        where r.token_hash = ${tokenHash}
          and r.used_at is null
          and r.expires_at > now()
          and s.active = true
          and e.status = 'active'
        limit 1
        for update of r
      `;
      if (!row) return null;

      const staffId = String(row.staff_user_id);
      const establishmentId = String(row.establishment_id);

      // Une seule transaction : changement du mot de passe, invalidation de
      // toutes les sessions existantes (token_version), consommation de ce
      // token, et invalidation de tout autre token reset encore actif pour
      // le même utilisateur.
      await tx`
        update staff_users
        set password_hash = ${passwordHash}, token_version = token_version + 1, updated_at = now()
        where id = ${staffId}
      `;
      await tx`update password_reset_tokens set used_at = now() where id = ${row.id}`;
      await tx`
        update password_reset_tokens
        set used_at = now()
        where staff_user_id = ${staffId} and id <> ${row.id} and used_at is null
      `;
      await tx`
        insert into audit_logs(establishment_id, staff_user_id, action, entity_type, entity_id)
        values(${establishmentId}, ${staffId}, 'PASSWORD_RESET_COMPLETED', 'staff_user', ${staffId})
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
    if (code === "42P01") {
      return Response.json({ error: "RESET_UNAVAILABLE" }, { status: 503, headers: PRIVATE_HEADERS });
    }
    throw error;
  }
}

export const POST = withApiErrorHandling("PASSWORD_RESET_CONSUME", handlePost);
