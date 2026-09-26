import { after } from "next/server";
import { cardRecoveryEnabled, cardRecoveryTestMode, createCardRecoveryToken } from "@/lib/card-recovery";
import { sql } from "@/lib/db";
import { sendCardRecoveryEmail } from "@/lib/email";
import { isEmail } from "@/lib/input";
import { getAppUrl } from "@/lib/app-url";
import { consumeRateLimit } from "@/lib/rate-limit";
import { PRIVATE_HEADERS, rejectCrossOrigin, requestIp } from "@/lib/security";
import { safeErrorCode, withApiErrorHandling } from "@/lib/observability";

const GENERIC_RESPONSE = {
  ok: true,
  message: "Si cette adresse est associée à une carte, vous allez recevoir un lien pour la retrouver.",
};

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
      select
        c.id as card_id,
        c.customer_id,
        c.establishment_id,
        e.name as restaurant_name
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
    const customerId = String(card.customer_id);
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

    const testMode = cardRecoveryTestMode();
    let messageId = "test-delivery";
    try {
      if (!testMode) {
        const delivered = await sendCardRecoveryEmail({
          to: email,
          restaurantName: String(card.restaurant_name),
          recoveryUrl,
          idempotencyKey: `card-recovery-${recovery.tokenHash}`,
        });
        messageId = delivered.messageId;
      }
    } catch (error) {
      const code = safeErrorCode(error, "EMAIL_SEND_FAILED");
      console.error("Card recovery email delivery failed", { code });
      await auditDeliveryFailure(establishmentId, cardId, code);
      return;
    }

    await sql.begin(async (tx) => {
      // Une clé stable par carte sérialise les confirmations concurrentes sans
      // imposer un verrou exclusif à toutes les cartes du commerce.
      await tx`select pg_advisory_xact_lock(hashtextextended(${cardId}, 149))`;

      // Ces verrous sont pris dans le même ordre que les opérations de cycle
      // de vie. Une rectification, un effacement ou une suspension concurrente
      // termine donc avant cette revalidation, ou révoque le lien après elle.
      const [establishment] = await tx`
        select id from establishments
        where id=${establishmentId} and status='active'
        for share
      `;
      const [customer] = establishment ? await tx`
        select id from customers
        where id=${customerId}
          and establishment_id=${establishmentId}
          and deleted_at is null
          and lower(email)=lower(${email})
        for share
      ` : [];
      const [currentCard] = customer ? await tx`
        select id from cards
        where id=${cardId}
          and customer_id=${customerId}
          and establishment_id=${establishmentId}
          and active=true
        for share
      ` : [];
      const [program] = currentCard ? await tx`
        select id from loyalty_programs
        where establishment_id=${establishmentId} and active=true
        limit 1
        for share
      ` : [];

      if (!establishment || !customer || !currentCard || !program) {
        await tx`
          insert into audit_logs(establishment_id, action, entity_type, entity_id, metadata)
          values(
            ${establishmentId},
            'CARD_RECOVERY_EMAIL_SENT',
            'card',
            ${cardId},
            ${tx.json({ provider: testMode ? "test" : "resend", messageId, activated: false })}
          )
        `;
        return;
      }

      // Le nouveau lien n'est activé qu'après confirmation du fournisseur et
      // après la revalidation verrouillée de toutes ses ressources.
      await tx`
        update card_recovery_tokens
        set used_at = now()
        where card_id = ${cardId} and id <> ${recoveryId} and used_at is null
      `;
      const [activated] = await tx`
        update card_recovery_tokens
        set used_at = null
        where id = ${recoveryId}
          and card_id = ${cardId}
          and establishment_id = ${establishmentId}
          and used_at is not null
          and expires_at > now()
        returning id
      `;
      if (!activated) return;
      await tx`
        insert into audit_logs(establishment_id, action, entity_type, entity_id, metadata)
        values(
          ${establishmentId},
          'CARD_RECOVERY_EMAIL_SENT',
          'card',
          ${cardId},
          ${tx.json({ provider: testMode ? "test" : "resend", messageId, activated: true })}
        )
      `;
    });
  } catch (error) {
    const code = safeErrorCode(error, "CARD_RECOVERY_BACKGROUND_FAILED");
    console.error("Card recovery background processing failed", { code });
  }
}

async function handlePost(req: Request) {
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

/**
 * `consumeRateLimit` interroge la base de façon synchrone avant la réponse :
 * une panne à cet instant ne doit pas faire fuiter une 500 brute (le flag
 * étant coupé en environnement de test, ce chemin n'était pas exercé).
 */
export const POST = withApiErrorHandling("RECOVERY_REQUEST", handlePost);
