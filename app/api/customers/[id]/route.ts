import { after } from "next/server";
import { getSession } from "@/lib/auth";
import { notifyAppleWalletRevocation } from "@/lib/apple-wallet";
import { changedContactFields, parseCustomerContactUpdate } from "@/lib/customer-contact";
import { sql } from "@/lib/db";
import { notifyGoogleWalletRevocation } from "@/lib/google-wallet";
import { canManageCustomers } from "@/lib/loyalty";
import { withApiErrorHandling } from "@/lib/observability";
import { enforceRateLimit } from "@/lib/rate-limit";
import { PRIVATE_HEADERS, rejectCrossOrigin } from "@/lib/security";
import { syncWalletsForCard } from "@/lib/wallet-sync";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "23505";
}

/** Rectification des coordonnées et retrait du consentement marketing (OWNER/MANAGER). */
async function handlePatch(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = rejectCrossOrigin(req);
  if (originError) return originError;
  const session = await getSession();
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401, headers: PRIVATE_HEADERS });
  if (!canManageCustomers(session.role)) return Response.json({ error: "FORBIDDEN" }, { status: 403, headers: PRIVATE_HEADERS });
  const limited = await enforceRateLimit(req, `customer-contact:${session.staffId}`, 60, 60 * 60);
  if (limited) return limited;

  const { id } = await params;
  if (!UUID.test(id)) return Response.json({ error: "NOT_FOUND" }, { status: 404, headers: PRIVATE_HEADERS });
  const parsed = parseCustomerContactUpdate(await req.json().catch(() => null));
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400, headers: PRIVATE_HEADERS });
  const { update } = parsed;

  let result;
  try {
    result = await sql.begin(async (tx) => {
      const [customer] = await tx`
        select u.first_name,u.email,u.phone,u.marketing_consent,c.id as card_id
        from customers u
        left join cards c on c.customer_id=u.id and c.establishment_id=u.establishment_id
        where u.id=${id} and u.establishment_id=${session.establishmentId} and u.deleted_at is null
        for update of u
      `;
      if (!customer) return null;
      const fields = changedContactFields({ first_name: customer.first_name, email: customer.email, phone: customer.phone }, update);
      const withdrawn = update.withdrawMarketing && customer.marketing_consent === true;
      if (!fields.length && !withdrawn) return { fields, withdrawn, cardId: null };

      await tx`
        update customers set
          first_name=${fields.includes("firstName") ? update.firstName ?? null : customer.first_name},
          email=${fields.includes("email") ? update.email ?? null : customer.email},
          phone=${fields.includes("phone") ? update.phone ?? null : customer.phone},
          marketing_consent=${withdrawn ? false : customer.marketing_consent},
          marketing_consent_at=case when ${withdrawn}::boolean then null else marketing_consent_at end,
          updated_at=now()
        where id=${id} and establishment_id=${session.establishmentId} and deleted_at is null
      `;
      // Noms des champs seulement : les anciennes et nouvelles coordonnées
      // ne doivent jamais survivre dans les journaux.
      if (fields.length) {
        await tx`
          insert into audit_logs(establishment_id,staff_user_id,action,entity_type,entity_id,metadata)
          values(${session.establishmentId},${session.staffId},'CUSTOMER_CONTACT_UPDATED','customer',${id},${tx.json({ fields })})
        `;
      }
      if (withdrawn) {
        await tx`
          insert into audit_logs(establishment_id,staff_user_id,action,entity_type,entity_id,metadata)
          values(${session.establishmentId},${session.staffId},'CUSTOMER_MARKETING_WITHDRAWN','customer',${id},${tx.json({})})
        `;
      }
      return { fields, withdrawn, cardId: customer.card_id ? String(customer.card_id) : null };
    });
  } catch (error) {
    // Adresse ou téléphone déjà porté par un autre client de ce commerce.
    if (isUniqueViolation(error)) return Response.json({ error: "CONTACT_ALREADY_USED" }, { status: 409, headers: PRIVATE_HEADERS });
    throw error;
  }

  if (!result) return Response.json({ error: "NOT_FOUND" }, { status: 404, headers: PRIVATE_HEADERS });
  // Le prénom figure sur la carte Google Wallet : la rectification doit l'atteindre.
  if (result.cardId && result.fields.includes("firstName")) {
    const cardId = result.cardId;
    after(() => syncWalletsForCard(cardId));
  }
  return Response.json({ ok: true, changed: result.fields, marketingWithdrawn: result.withdrawn }, { headers: PRIVATE_HEADERS });
}

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

export const PATCH = withApiErrorHandling("CUSTOMER_CONTACT_UPDATE", handlePatch);
export const DELETE = withApiErrorHandling("CUSTOMER_DELETE", handleDelete);
