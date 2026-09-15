import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const url = new URL(req.url);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 20)));

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
  return Response.json(rows);
}
