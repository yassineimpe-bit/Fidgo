import { after } from "next/server";
import { getAppUrl } from "@/lib/app-url";
import { sql } from "@/lib/db";
import { emailDeliveryConfigured, sendEmailVerificationEmail } from "@/lib/email";
import { createEmailVerificationToken, emailVerificationTestMode } from "@/lib/email-verification";
import { isEmail } from "@/lib/input";
import { safeErrorCode, withApiErrorHandling } from "@/lib/observability";
import { consumeRateLimit } from "@/lib/rate-limit";
import { PRIVATE_HEADERS, rejectCrossOrigin, requestIp } from "@/lib/security";

const GENERIC_RESPONSE = {
  ok: true,
  message: "Si ce compte doit encore être vérifié, un nouveau lien vient d’être envoyé.",
};

async function auditDeliveryFailure(establishmentId: string, staffId: string, code: string) {
  try {
    await sql`
      insert into audit_logs(establishment_id, staff_user_id, action, entity_type, entity_id, metadata)
      values(${establishmentId}, ${staffId}, 'EMAIL_VERIFICATION_EMAIL_FAILED', 'staff_user', ${staffId}, ${sql.json({ code })})
    `;
  } catch {}
}

async function processResend(email: string) {
  try {
    const [staff] = await sql`
      select s.id as staff_id, s.establishment_id, e.name as establishment_name
      from staff_users s
      join establishments e on e.id = s.establishment_id
      where lower(s.email) = ${email}
        and s.email_verified_at is null
        and s.active = true
        and e.status = 'active'
      limit 1
    `;
    if (!staff) return;

    const staffId = String(staff.staff_id);
    const establishmentId = String(staff.establishment_id);
    const restaurantName = String(staff.establishment_name || "votre commerce");
    const base = getAppUrl();
    if (!base || !emailDeliveryConfigured()) {
      await auditDeliveryFailure(establishmentId, staffId, "EMAIL_NOT_CONFIGURED");
      return;
    }

    const verification = createEmailVerificationToken();
    // Le nouveau token n'est activé qu'après confirmation du fournisseur :
    // une panne d'envoi ne doit pas casser un lien précédent encore valable.
    const [created] = await sql`
      insert into email_verification_tokens(staff_user_id, token_hash, expires_at, used_at)
      values(${staffId}, ${verification.tokenHash}, ${verification.expiresAt}, now())
      returning id
    `;
    const tokenId = String(created.id);
    const verifyUrl = `${base}/verify-email?token=${verification.token}`;

    const testMode = emailVerificationTestMode();
    let messageId = "test-delivery";
    try {
      if (!testMode) {
        const delivered = await sendEmailVerificationEmail({
          to: email,
          restaurantName,
          verificationUrl: verifyUrl,
          idempotencyKey: `email-verification-${verification.tokenHash}`,
        });
        messageId = delivered.messageId;
      }
    } catch (error) {
      const code = safeErrorCode(error, "EMAIL_SEND_FAILED");
      console.error("Verification email resend failed", { code });
      await auditDeliveryFailure(establishmentId, staffId, code);
      return;
    }

    await sql.begin(async (tx) => {
      // Sérialise l'activation des liens concurrents et revérifie l'état après
      // l'appel au fournisseur. Un compte vérifié ou révoqué entre-temps ne
      // récupère jamais un nouveau lien actif.
      const [eligible] = await tx`
        select s.id
        from staff_users s
        join establishments e on e.id=s.establishment_id
        where s.id=${staffId}
          and s.email_verified_at is null
          and s.active=true
          and e.status='active'
        for update of s, e
      `;
      if (!eligible) return;
      await tx`
        update email_verification_tokens
        set used_at = now()
        where staff_user_id = ${staffId} and id <> ${tokenId} and used_at is null
      `;
      await tx`
        update email_verification_tokens
        set used_at = null
        where id = ${tokenId} and staff_user_id = ${staffId}
      `;
      await tx`
        insert into audit_logs(establishment_id, staff_user_id, action, entity_type, entity_id, metadata)
        values(
          ${establishmentId},
          ${staffId},
          'EMAIL_VERIFICATION_EMAIL_SENT',
          'staff_user',
          ${staffId},
          ${tx.json({ provider: testMode ? "test" : "resend", messageId, resend: true })}
        )
      `;
    });
  } catch (error) {
    const code = safeErrorCode(error, "EMAIL_VERIFICATION_RESEND_BACKGROUND_FAILED");
    console.error("Verification email resend background processing failed", { code });
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

  const byIp = await consumeRateLimit(`email-verification-resend-ip:${requestIp(req)}`, 10, 60 * 60);
  const byAddress = await consumeRateLimit(`email-verification-resend-email:${email}`, 5, 60 * 60);
  if (!byIp.allowed || !byAddress.allowed) {
    return Response.json(GENERIC_RESPONSE, { status: 202, headers: PRIVATE_HEADERS });
  }

  after(() => processResend(email));
  return Response.json(GENERIC_RESPONSE, { status: 202, headers: PRIVATE_HEADERS });
}

export const POST = withApiErrorHandling("EMAIL_VERIFICATION_RESEND", handlePost);
