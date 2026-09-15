import { after } from "next/server";
import { sql } from "@/lib/db";
import { sendStaffPasswordResetEmail } from "@/lib/email";
import { isEmail } from "@/lib/input";
import { getAppUrl } from "@/lib/app-url";
import { consumeRateLimit } from "@/lib/rate-limit";
import { createStaffResetToken, staffPasswordResetEnabled } from "@/lib/staff-password-reset";
import { PRIVATE_HEADERS, rejectCrossOrigin, requestIp } from "@/lib/security";

const GENERIC_RESPONSE = {
  ok: true,
  message: "Si cette adresse est associée à un compte, un lien de réinitialisation va être envoyé.",
};

export async function POST(req: Request) {
  const originError = rejectCrossOrigin(req);
  if (originError) return originError;

  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase().slice(0, 254);
  if (!isEmail(email)) {
    return Response.json({ error: "INVALID_INPUT" }, { status: 400, headers: PRIVATE_HEADERS });
  }

  // Reste opaque tant que le domaine/Resend ne sont pas stabilisés, comme la
  // récupération de carte : mieux vaut un no-op silencieux qu'un envoi cassé.
  if (!staffPasswordResetEnabled()) {
    return Response.json(GENERIC_RESPONSE, { status: 202, headers: PRIVATE_HEADERS });
  }

  const byIp = await consumeRateLimit(`password-forgot-ip:${requestIp(req)}`, 10, 60 * 60);
  const byAddress = await consumeRateLimit(`password-forgot-email:${email}`, 5, 60 * 60);
  if (!byIp.allowed || !byAddress.allowed) {
    return Response.json(GENERIC_RESPONSE, { status: 202, headers: PRIVATE_HEADERS });
  }

  const [staff] = await sql`
    select s.id, s.establishment_id
    from staff_users s
    join establishments e on e.id = s.establishment_id
    where lower(s.email) = ${email}
      and s.active = true
      and e.status = 'active'
    limit 1
  `;

  // Meme reponse, meme statut, que le compte existe ou non : ne pas devenir
  // un oracle d'enumeration des adresses commerçantes.
  if (!staff) return Response.json(GENERIC_RESPONSE, { status: 202, headers: PRIVATE_HEADERS });

  const reset = createStaffResetToken();
  await sql.begin(async (tx) => {
    // Seul le lien le plus recent reste utilisable.
    await tx`
      update staff_password_reset_tokens
      set used_at = now()
      where staff_user_id = ${staff.id} and used_at is null
    `;
    await tx`
      insert into staff_password_reset_tokens(establishment_id, staff_user_id, token_hash, expires_at)
      values(${staff.establishment_id}, ${staff.id}, ${reset.tokenHash}, ${reset.expiresAt})
    `;
  });

  const base = getAppUrl();
  if (base) {
    const resetUrl = `${base}/reset-password/${reset.token}`;
    after(async () => {
      try {
        await sendStaffPasswordResetEmail({ to: email, resetUrl });
      } catch (error) {
        const message = error instanceof Error ? error.message : "EMAIL_SEND_FAILED";
        console.error("Staff password reset email delivery failed", { code: message });
        try {
          await sql`
            insert into audit_logs(establishment_id, staff_user_id, action, entity_type, entity_id, metadata)
            values(${staff.establishment_id}, ${staff.id}, 'STAFF_PASSWORD_RESET_EMAIL_FAILED', 'staff_user', ${String(staff.id)}, ${sql.json({ code: message.slice(0, 120) })})
          `;
        } catch {}
      }
    });
  }

  return Response.json(GENERIC_RESPONSE, { status: 202, headers: PRIVATE_HEADERS });
}
