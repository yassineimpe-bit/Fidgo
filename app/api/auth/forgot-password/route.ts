import { after } from "next/server";
import { sql } from "@/lib/db";
import { sendPasswordResetEmail } from "@/lib/email";
import { createPasswordResetToken } from "@/lib/password-reset";
import { isEmail } from "@/lib/input";
import { getAppUrl } from "@/lib/app-url";
import { consumeRateLimit } from "@/lib/rate-limit";
import { PRIVATE_HEADERS, rejectCrossOrigin, requestIp } from "@/lib/security";
import { safeErrorCode, withApiErrorHandling } from "@/lib/observability";

const GENERIC_RESPONSE = {
  ok: true,
  message: "Si un compte correspond à cette adresse e-mail, un lien de réinitialisation vient d’être envoyé.",
};

async function auditDeliveryFailure(establishmentId: string, staffId: string, code: string) {
  try {
    await sql`
      insert into audit_logs(establishment_id, staff_user_id, action, entity_type, entity_id, metadata)
      values(${establishmentId}, ${staffId}, 'PASSWORD_RESET_EMAIL_FAILED', 'staff_user', ${staffId}, ${sql.json({ code })})
    `;
  } catch {}
}

async function processForgotPassword(email: string) {
  try {
    const [staff] = await sql`
      select s.id as staff_id, s.establishment_id
      from staff_users s
      join establishments e on e.id = s.establishment_id
      where lower(s.email) = ${email}
        and s.active = true
        and e.status = 'active'
      limit 1
    `;
    if (!staff) return;

    const staffId = String(staff.staff_id);
    const establishmentId = String(staff.establishment_id);
    const base = getAppUrl();
    if (!base) {
      await auditDeliveryFailure(establishmentId, staffId, "EMAIL_APP_URL_MISSING");
      return;
    }

    const reset = createPasswordResetToken();
    // Comme card_recovery_tokens : la ligne n'est activée qu'après confirmation
    // du fournisseur. Un envoi Resend en échec ne doit pas invalider le lien
    // précédent, encore valide, de cet utilisateur.
    const [created] = await sql`
      insert into password_reset_tokens(staff_user_id, token_hash, expires_at, used_at)
      values(${staffId}, ${reset.tokenHash}, ${reset.expiresAt}, now())
      returning id
    `;
    const resetId = String(created.id);
    const resetUrl = `${base}/reset-password?token=${reset.token}`;

    let messageId: string;
    try {
      const delivered = await sendPasswordResetEmail({
        to: email,
        resetUrl,
        idempotencyKey: `password-reset-${reset.tokenHash}`,
      });
      messageId = delivered.messageId;
    } catch (error) {
      const code = safeErrorCode(error, "EMAIL_SEND_FAILED");
      console.error("Password reset email delivery failed", { code });
      await auditDeliveryFailure(establishmentId, staffId, code);
      return;
    }

    await sql.begin(async (tx) => {
      await tx`
        update password_reset_tokens
        set used_at = now()
        where staff_user_id = ${staffId} and id <> ${resetId} and used_at is null
      `;
      await tx`
        update password_reset_tokens
        set used_at = null
        where id = ${resetId} and staff_user_id = ${staffId}
      `;
      await tx`
        insert into audit_logs(establishment_id, staff_user_id, action, entity_type, entity_id, metadata)
        values(
          ${establishmentId},
          ${staffId},
          'PASSWORD_RESET_EMAIL_SENT',
          'staff_user',
          ${staffId},
          ${tx.json({ provider: "resend", messageId })}
        )
      `;
    });
  } catch (error) {
    const code = safeErrorCode(error, "PASSWORD_RESET_BACKGROUND_FAILED");
    console.error("Password reset background processing failed", { code });
  }
}

async function handlePost(req: Request) {
  const originError = rejectCrossOrigin(req);
  if (originError) return originError;

  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase().slice(0, 254);
  if (!isEmail(email)) {
    return Response.json({ error: "INVALID_INPUT" }, { status: 400, headers: PRIVATE_HEADERS });
  }

  // Deux compteurs comme /api/recovery/request : le statut renvoyé reste
  // identique qu'une limite soit atteinte ou non, pour ne jamais laisser un
  // code de réponse distinguer "traitement en cours" de "trop de tentatives".
  const byIp = await consumeRateLimit(`forgot-password-ip:${requestIp(req)}`, 10, 60 * 60);
  const byAddress = await consumeRateLimit(`forgot-password-email:${email}`, 5, 60 * 60);
  if (!byIp.allowed || !byAddress.allowed) {
    return Response.json(GENERIC_RESPONSE, { status: 202, headers: PRIVATE_HEADERS });
  }

  // Toute recherche et tout envoi ont lieu après la réponse afin qu'un compte
  // existant ne puisse pas être distingué par le temps de réponse.
  after(() => processForgotPassword(email));

  return Response.json(GENERIC_RESPONSE, { status: 202, headers: PRIVATE_HEADERS });
}

export const POST = withApiErrorHandling("FORGOT_PASSWORD", handlePost);
