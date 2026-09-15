import bcrypt from "bcryptjs";
import { sql } from "@/lib/db";
import { hashStaffResetToken, isValidStaffResetToken } from "@/lib/staff-password-reset";
import { consumeRateLimit } from "@/lib/rate-limit";
import { PRIVATE_HEADERS, rejectCrossOrigin, requestIp } from "@/lib/security";

export async function POST(req: Request) {
  const originError = rejectCrossOrigin(req);
  if (originError) return originError;

  const limited = await consumeRateLimit(`password-reset-consume:${requestIp(req)}`, 30, 60 * 60);
  if (!limited.allowed) {
    return Response.json({ error: "TOO_MANY_ATTEMPTS" }, { status: 429, headers: PRIVATE_HEADERS });
  }

  const body = await req.json().catch(() => ({}));
  const token = String(body.token || "").trim();
  const password = String(body.password || "");
  if (!isValidStaffResetToken(token) || password.length < 8 || password.length > 256) {
    return Response.json({ error: "INVALID_INPUT" }, { status: 400, headers: PRIVATE_HEADERS });
  }

  const tokenHash = hashStaffResetToken(token);
  const passwordHash = await bcrypt.hash(password, 12);

  const reset = await sql.begin(async (tx) => {
    const [row] = await tx`
      select r.id, r.establishment_id, r.staff_user_id
      from staff_password_reset_tokens r
      join staff_users s on s.id = r.staff_user_id
      join establishments e on e.id = r.establishment_id
      where r.token_hash = ${tokenHash}
        and r.used_at is null
        and r.expires_at > now()
        and s.active = true
        and e.status = 'active'
      limit 1
      for update of r
    `;
    if (!row) return null;

    await tx`update staff_password_reset_tokens set used_at = now() where id = ${row.id}`;
    // token_version + 1 revoque toutes les sessions existantes : un lien de
    // reset qui fuit ne doit pas laisser une session deja ouverte survivre.
    await tx`
      update staff_users
      set password_hash = ${passwordHash}, token_version = token_version + 1, updated_at = now()
      where id = ${row.staff_user_id}
    `;
    await tx`
      insert into audit_logs(establishment_id, staff_user_id, action, entity_type, entity_id)
      values(${row.establishment_id}, ${row.staff_user_id}, 'STAFF_PASSWORD_RESET', 'staff_user', ${String(row.staff_user_id)})
    `;
    return row;
  });

  if (!reset) {
    return Response.json({ error: "INVALID_OR_EXPIRED_LINK" }, { status: 400, headers: PRIVATE_HEADERS });
  }
  return Response.json({ ok: true }, { headers: PRIVATE_HEADERS });
}
