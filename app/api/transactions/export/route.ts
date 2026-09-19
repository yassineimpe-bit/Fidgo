import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { canManageProgram } from "@/lib/loyalty";
import { withApiErrorHandling } from "@/lib/observability";
import { enforceRateLimit } from "@/lib/rate-limit";
import { PRIVATE_HEADERS } from "@/lib/security";
import { parseTransactionHistoryFilters } from "@/lib/transaction-history";
import { transactionExportCsv } from "@/lib/transaction-export";

async function handleGet(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401, headers: PRIVATE_HEADERS });
  if (!canManageProgram(session.role)) return Response.json({ error: "FORBIDDEN" }, { status: 403, headers: PRIVATE_HEADERS });

  const limited = await enforceRateLimit(req, `transactions-export:${session.staffId}`, 10, 60 * 60);
  if (limited) return limited;

  const url = new URL(req.url);
  const filters = parseTransactionHistoryFilters({
    q: url.searchParams.get("q") || undefined,
    type: url.searchParams.get("type") || undefined,
    period: url.searchParams.get("period") || undefined,
  });
  const searchPattern = `%${filters.q.toLowerCase()}%`;

  const rows = await sql`
    select
      t.created_at,u.first_name,c.short_code,t.type,t.delta,t.balance_after,t.unit,
      st.email as staff_email,
      exists(select 1 from transactions x where x.reversed_transaction_id=t.id) as reversed
    from transactions t
    join cards c on c.id=t.card_id
    join customers u on u.id=c.customer_id
    left join staff_users st on st.id=t.staff_user_id
    where t.establishment_id=${session.establishmentId}
      and (${filters.q} = '' or lower(coalesce(u.first_name,'')) like ${searchPattern}
        or lower(coalesce(c.short_code,'')) like ${searchPattern}
        or lower(coalesce(st.email,'')) like ${searchPattern})
      and (${filters.type} = 'ALL' or t.type = ${filters.type})
      and (${filters.days} = 0 or t.created_at >= now() - (${filters.days}::int * interval '1 day'))
    order by t.created_at desc
    limit 5000
  `;

  const csv = transactionExportCsv(rows.map((row) => ({
    created_at: String(row.created_at),
    first_name: row.first_name ? String(row.first_name) : null,
    short_code: String(row.short_code),
    type: String(row.type),
    delta: Number(row.delta),
    balance_after: Number(row.balance_after),
    unit: String(row.unit),
    staff_email: row.staff_email ? String(row.staff_email) : null,
    reversed: Boolean(row.reversed),
  })));

  const date = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      ...PRIVATE_HEADERS,
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="retiko-transactions-${date}.csv"`,
    },
  });
}

export const GET = withApiErrorHandling("TRANSACTIONS_EXPORT", handleGet);
