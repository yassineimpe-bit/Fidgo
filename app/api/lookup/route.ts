import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q) return Response.json({ error: "INVALID_QUERY" }, { status: 400 });

  const [row] = await sql`
    select c.token, c.short_code, c.balance, u.first_name, u.email, p.mode, p.reward_threshold
    from cards c
    join customers u on u.id = c.customer_id
    join loyalty_programs p on p.establishment_id = c.establishment_id
    where c.establishment_id = ${session.establishmentId}
      and u.deleted_at is null
      and (upper(c.short_code) = upper(${q}) or lower(u.email) = lower(${q}))
    limit 1
  `;
  return row ? Response.json(row) : Response.json({ error: "NOT_FOUND" }, { status: 404 });
}
