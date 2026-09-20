import { after } from "next/server";
import { getSession } from "@/lib/auth";
import { notifyAppleWalletRevocation } from "@/lib/apple-wallet";
import { sql } from "@/lib/db";
import { notifyGoogleWalletRevocation } from "@/lib/google-wallet";
import { canManageCustomers } from "@/lib/loyalty";
import { withApiErrorHandling } from "@/lib/observability";
import { enforceRateLimit } from "@/lib/rate-limit";
import { PRIVATE_HEADERS, rejectCrossOrigin } from "@/lib/security";

async function handleDelete(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = rejectCrossOrigin(req);
  if (originError) return originError;
  const session = await getSession();
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401, headers: PRIVATE_HEADERS });
  if (!canManageCustomers(session.role)) return Response.json({ error: "FORBIDDEN" }, { status: 403, headers: PRIVATE_HEADERS });

  // Transaction lourde et irreversible : un compte compromis pouvait effacer
  // toute la base clients en rafale, sans aucun frein.
  const limited = await enforceRateLimit(req, `customer-erase:${session.staffId}`, 20, 60 * 60);
  if (limited) return limited;

  const { id } = await params;
  const result = await sql.begin(async (tx) => {
    const [customer] = await tx`
      select id from customers
      where id=${id} and establishment_id=${session.establishmentId} and deleted_at is null
      limit 1
    `;
    if (!customer) return null;

    // Toutes les mutations de solde verrouillent la carte. Prendre le même
    // verrou sérialise proprement effacement, crédit, redemption et ajustement.
    const cards = await tx`
      select id from cards
      where customer_id=${id} and establishment_id=${session.establishmentId}
      for update
    `;
    const [erased] = await tx`
      update customers set
        email=null,
        phone=null,
        first_name=null,
        internal_note=null,
        marketing_consent=false,
        marketing_consent_at=null,
        deleted_at=now(),
        updated_at=now()
      where id=${id} and establishment_id=${session.establishmentId} and deleted_at is null
      returning id
    `;
    if (!erased) return null;

    // Les identifiants publics ne servent pas au ledger : ils sont remplacés
    // afin que les anciens QR, URLs et codes courts soient irrévocables.
    await tx`
      update cards set
        active=false,
        token='ERASED_' || encode(gen_random_bytes(32),'hex'),
        short_code='ERASED-' || id::text,
        updated_at=now()
      where customer_id=${id} and establishment_id=${session.establishmentId}
    `;
    await tx`
      update card_recovery_tokens set used_at=coalesce(used_at,now())
      where establishment_id=${session.establishmentId}
        and card_id in (select id from cards where customer_id=${id} and establishment_id=${session.establishmentId})
    `;
    await tx`
      update wallet_passes set status='revoked',last_error=null,updated_at=now()
      where establishment_id=${session.establishmentId}
        and card_id in (select id from cards where customer_id=${id} and establishment_id=${session.establishmentId})
    `;
    await tx`delete from push_subscriptions where customer_id=${id} and establishment_id=${session.establishmentId}`;
    await tx`delete from campaign_recipients where customer_id=${id}`;

    // La télémétrie agrégée reste utile mais n'a plus besoin du lien carte.
    await tx`
      update product_events set card_id=null
      where establishment_id=${session.establishmentId}
        and card_id in (select id from cards where customer_id=${id} and establishment_id=${session.establishmentId})
    `;
    // Le ledger et les audits sont conservés, sans motifs libres susceptibles
    // de contenir une donnée saisie inutilement par un opérateur.
    await tx`
      update transactions set metadata=metadata - 'reason' - 'overrideReason'
      where establishment_id=${session.establishmentId}
        and card_id in (select id from cards where customer_id=${id} and establishment_id=${session.establishmentId})
    `;
    await tx`
      update audit_logs set metadata=metadata - 'reason' - 'overrideReason'
      where establishment_id=${session.establishmentId}
        and entity_type='card'
        and entity_id in (
          select id::text from cards where customer_id=${id} and establishment_id=${session.establishmentId}
        )
    `;
    await tx`
      insert into audit_logs(establishment_id,staff_user_id,action,entity_type,entity_id,metadata)
      values(
        ${session.establishmentId},${session.staffId},'CUSTOMER_ERASE','customer',${id},
        ${tx.json({ cardsRevoked: cards.length, ledgerPreserved: true })}
      )
    `;
    return { cardIds: cards.map((card) => String(card.id)) };
  });

  if (!result) return Response.json({ error: "NOT_FOUND" }, { status: 404, headers: PRIVATE_HEADERS });
  if (result.cardIds.length) {
    after(() => Promise.allSettled(result.cardIds.flatMap((cardId) => [notifyAppleWalletRevocation(cardId), notifyGoogleWalletRevocation(cardId)])));
  }
  return Response.json({ ok: true }, { headers: PRIVATE_HEADERS });
}

export const DELETE = withApiErrorHandling("CUSTOMER_DELETE", handleDelete);
