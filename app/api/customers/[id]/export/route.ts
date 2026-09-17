import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { canManageProgram } from "@/lib/loyalty";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!canManageProgram(session.role)) return Response.json({ error: "FORBIDDEN" }, { status: 403 });

  const { id } = await params;
  const [customer] = await sql`
    select id,email,phone,first_name,marketing_consent,marketing_consent_at,created_at,updated_at
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
