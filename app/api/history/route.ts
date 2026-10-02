import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { parseHistoryLimit } from "@/lib/history";
import { canAccessBackoffice } from "@/lib/loyalty";
import { withApiErrorHandling } from "@/lib/observability";
import { enforceRateLimit } from "@/lib/rate-limit";

async function handleGet(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!canAccessBackoffice(session.role)) return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  // Agregat coûteux (jointures + sous-requete d'existence) : plafonne pour
  // qu'une session valide ne puisse pas le marteler.
  const limited = await enforceRateLimit(req, `history:${session.staffId}`, 120, 60);
  if (limited) return limited;
  const url = new URL(req.url);
  const limit = parseHistoryLimit(url.searchParams.get("limit"));

  const rows = await sql`
    select
      t.id, t.type, t.delta, t.balance_after, t.unit, t.created_at,
      c.short_code, u.first_name, s.email as staff_email,
      exists(select 1 from transactions r where r.reversed_transaction_id = t.id) as reversed
    from transactions t
    join cards c on c.id = t.card_id
    join customers u on u.id = c.customer_id
    left join staff_users s on s.id = t.staff_user_id
    where t.establishment_id = ${session.establishmentId}
    order by t.created_at desc
    limit ${limit}
  `;
  return Response.json(rows, { headers: { "cache-control": "no-store" } });
}

export const GET = withApiErrorHandling("HISTORY", handleGet);
