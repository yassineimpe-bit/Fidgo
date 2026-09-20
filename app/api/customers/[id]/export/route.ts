import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { canManageCustomers } from "@/lib/loyalty";
import { withApiErrorHandling } from "@/lib/observability";
import { enforceRateLimit } from "@/lib/rate-limit";

async function handleGet(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!canManageCustomers(session.role)) return Response.json({ error: "FORBIDDEN" }, { status: 403 });

  // Un export RGPD est unitaire et rare. Sans plafond, un compte OWNER/MANAGER
  // compromis aspirait la base clients entiere, fiche par fiche. 20/h couvre
  // tout usage legitime et rend l'aspiration lente et bruyante.
  const limited = await enforceRateLimit(req, `customer-export:${session.staffId}`, 20, 60 * 60);
  if (limited) return limited;

  const { id } = await params;
  const [customer] = await sql`
    select id,email,phone,first_name,internal_note,marketing_consent,marketing_consent_at,created_at,updated_at
    from customers
    where id=${id} and establishment_id=${session.establishmentId} and deleted_at is null
  `;
  if (!customer) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  const [establishment] = await sql`
    select id,slug,name from establishments where id=${session.establishmentId}
  `;
  const [card] = await sql`
    select id,short_code,balance,last_earn_at,expires_at,active,created_at,updated_at
    from cards where customer_id=${id} and establishment_id=${session.establishmentId}
  `;
  const cardId = card ? String(card.id) : null;
  const transactions = cardId ? await sql`
    select id,type,delta,balance_after,unit,reversed_transaction_id,metadata,created_at
    from transactions
    where card_id=${cardId} and establishment_id=${session.establishmentId}
    order by created_at
  ` : [];
  const walletPasses = cardId ? await sql`
    select provider,status,created_at,updated_at,last_synced_at
    from wallet_passes
    where card_id=${cardId} and establishment_id=${session.establishmentId}
    order by provider
  ` : [];
  const recoveryRequests = cardId ? await sql`
    select created_at,expires_at,used_at,
      case when used_at is not null then 'used' when expires_at <= now() then 'expired' else 'active' end as status
    from card_recovery_tokens
    where card_id=${cardId} and establishment_id=${session.establishmentId}
    order by created_at
  ` : [];
  const productEvents = cardId ? await sql`
    select event_type,duration_ms,metadata,created_at
    from product_events
    where card_id=${cardId} and establishment_id=${session.establishmentId}
    order by created_at
  ` : [];
  const audits = await sql`
    select action,entity_type,metadata,created_at
    from audit_logs
    where establishment_id=${session.establishmentId}
      and ((entity_type='customer' and entity_id=${id})
        or (${cardId}::text is not null and entity_type='card' and entity_id=${cardId}))
    order by created_at
  `;

  // L'effacement (CUSTOMER_ERASE) et l'ajustement (CARD_ADJUSTED) etaient
  // traces, pas la lecture complete du dossier. Une exfiltration par un compte
  // legitime ne laissait donc aucune trace exploitable en reponse a incident.
  await sql`
    insert into audit_logs(establishment_id, staff_user_id, action, entity_type, entity_id, metadata)
    values(
      ${session.establishmentId}, ${session.staffId}, 'CUSTOMER_EXPORT', 'customer', ${id},
      ${sql.json({ transactions: transactions.length, hasCard: Boolean(cardId) })}
    )
  `;

  const body = JSON.stringify({
    format: "retiko-customer-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    establishment,
    customer,
    card,
    transactions,
    walletPasses,
    recoveryRequests,
    productEvents,
    auditTrail: audits,
  }, null, 2);

  return new Response(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="retiko-customer-${id}.json"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export const GET = withApiErrorHandling("CUSTOMER_EXPORT", handleGet);
