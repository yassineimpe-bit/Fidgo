import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { canScan } from "@/lib/loyalty";
import { enforceRateLimit } from "@/lib/rate-limit";
import { PRIVATE_HEADERS } from "@/lib/security";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  // Cette route renvoie un token de carte : reservee aux roles qui scannent.
  // Un VIEWER (lecture seule) n'a aucune raison de pouvoir l'obtenir.
  if (!canScan(session.role)) return Response.json({ error: "FORBIDDEN" }, { status: 403 });

  // Sans limite, un compte employe pouvait enumerer les codes courts et tester
  // l'existence d'adresses email en masse.
  const limited = await enforceRateLimit(req, `lookup:${session.staffId}`, 60, 60);
  if (limited) return limited;

  const q = new URL(req.url).searchParams.get("q")?.trim().slice(0, 254);
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
  return row
    ? Response.json(row, { headers: PRIVATE_HEADERS })
    : Response.json({ error: "NOT_FOUND" }, { status: 404 });
}
