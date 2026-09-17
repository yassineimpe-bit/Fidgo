import { after } from "next/server";
import { cardRecoveryEnabled, createCardRecoveryToken } from "@/lib/card-recovery";
import { sql } from "@/lib/db";
import { sendCardRecoveryEmail } from "@/lib/email";
import { isEmail } from "@/lib/input";
import { getAppUrl } from "@/lib/app-url";
import { consumeRateLimit } from "@/lib/rate-limit";
import { PRIVATE_HEADERS, rejectCrossOrigin, requestIp } from "@/lib/security";

const GENERIC_RESPONSE = {
  ok: true,
  message: "Si cette adresse est associée à une carte, vous allez recevoir un lien pour la retrouver.",
};

function errorCode(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message.slice(0, 120);
  if (typeof error === "object" && error && "code" in error) {
    return String((error as { code?: unknown }).code).slice(0, 120);
  }
  return fallback;
}

async function auditDeliveryFailure(establishmentId: string, cardId: string, code: string) {
  try {
    await sql`
      insert into audit_logs(establishment_id, action, entity_type, entity_id, metadata)
      values(${establishmentId}, 'CARD_RECOVERY_EMAIL_FAILED', 'card', ${cardId}, ${sql.json({ code })})
    `;
  } catch {}
}

async function processRecoveryRequest(slug: string, email: string) {
  try {
    const [card] = await sql`
      select c.id as card_id, c.establishment_id, e.name as restaurant_name
      from cards c
      join customers u on u.id = c.customer_id
      join establishments e on e.id = c.establishment_id
      join loyalty_programs p on p.establishment_id = e.id
      where e.slug = ${slug}
        and e.status = 'active'
        and p.active = true
        and c.active = true
        and u.deleted_at is null
        and lower(u.email) = lower(${email})
      limit 1
    `;
    if (!card) return;

    const establishmentId = String(card.establishment_id);
    const cardId = String(card.card_id);
    const base = getAppUrl();
    if (!base) {
      await auditDeliveryFailure(establishmentId, cardId, "EMAIL_APP_URL_MISSING");
      return;
    }

    const recovery = createCardRecoveryToken();
    const [created] = await sql`
      insert into card_recovery_tokens(establishment_id, card_id, token_hash, expires_at, used_at)
      values(${establishmentId}, ${cardId}, ${recovery.tokenHash}, ${recovery.expiresAt}, now())
      returning id
    `;
    const recoveryId = String(created.id);
    const recoveryUrl = `${base}/recover/${recovery.token}`;

    let messageId: string;
    try {
      const delivered = await sendCardRecoveryEmail({
        to: email,
        restaurantName: String(card.restaurant_name),
        recoveryUrl,
        idempotencyKey: `card-recovery-${recovery.tokenHash}`,
      });
      messageId = delivered.messageId;
    } catch (error) {
      const code = errorCode(error, "EMAIL_SEND_FAILED");
      console.error("Card recovery email delivery failed", { code });
      await auditDeliveryFailure(establishmentId, cardId, code);
      return;
    }

    await sql.begin(async (tx) => {
      // Le nouveau lien n'est activé qu'après confirmation du fournisseur.
      // Cela conserve le précédent si Resend échoue et sérialise les demandes
      // concurrentes : le dernier envoi confirmé reste le seul lien actif.
      await tx`
        update card_recovery_tokens
        set used_at = now()
        where card_id = ${cardId} and id <> ${recoveryId} and used_at is null
      `;
      await tx`
        update card_recovery_tokens
        set used_at = null
        where id = ${recoveryId} and card_id = ${cardId}
      `;
      await tx`
        insert into audit_logs(establishment_id, action, entity_type, entity_id, metadata)
        values(
          ${establishmentId},
          'CARD_RECOVERY_EMAIL_SENT',
          'card',
          ${cardId},
          ${tx.json({ provider: "resend", messageId })}
        )
      `;
    });
  } catch (error) {
    const code = errorCode(error, "CARD_RECOVERY_BACKGROUND_FAILED");
    console.error("Card recovery background processing failed", { code });
  }
}

export async function POST(req: Request) {
  const originError = rejectCrossOrigin(req);
  if (originError) return originError;

  const body = await req.json().catch(() => ({}));
  const slug = String(body.slug || "").trim().slice(0, 60);
  const email = String(body.email || "").trim().toLowerCase().slice(0, 254);
  if (!slug || !isEmail(email)) {
    return Response.json({ error: "INVALID_INPUT" }, { status: 400, headers: PRIVATE_HEADERS });
  }

  if (!cardRecoveryEnabled()) {
    return Response.json(GENERIC_RESPONSE, { status: 202, headers: PRIVATE_HEADERS });
  }

  const byIp = await consumeRateLimit(`recovery-ip:${requestIp(req)}:${slug}`, 10, 60 * 60);
  const byAddress = await consumeRateLimit(`recovery-email:${slug}:${email}`, 5, 60 * 60);
  if (!byIp.allowed || !byAddress.allowed) {
    return Response.json(GENERIC_RESPONSE, { status: 202, headers: PRIVATE_HEADERS });
  }

  // Toute recherche et tout envoi ont lieu après la réponse afin qu'une
  // adresse existante ne puisse pas être distinguée par le temps de réponse.
  after(() => processRecoveryRequest(slug, email));

  return Response.json(GENERIC_RESPONSE, { status: 202, headers: PRIVATE_HEADERS });
}
