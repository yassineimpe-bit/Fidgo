import { sql } from "@/lib/db";
import { parseCardToken } from "@/lib/loyalty";
import { enforceRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token: input } = await params;
  const token = parseCardToken(input);
  if (!token) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  // Une carte visible appelle cette route toutes les trois secondes. Ce bucket
  // est volontairement distinct des lectures publiques classiques.
  const limited = await enforceRateLimit(request, `card-status:${token}`, 125, 6 * 60);
  if (limited) return limited;

  const [card] = await sql`
    select c.balance, c.updated_at, c.expires_at, p.reward_threshold
    from cards c
    join customers u on u.id = c.customer_id
    join establishments e on e.id = c.establishment_id
    join loyalty_programs p on p.establishment_id = c.establishment_id
    where c.token = ${token}
      and c.active = true
      and u.deleted_at is null
      and e.status = 'active'
      and p.active = true
    limit 1
  `;

  if (!card || (card.expires_at && new Date(card.expires_at) < new Date())) {
    return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const balance = Number(card.balance);
  const threshold = Number(card.reward_threshold);
  return Response.json({
    balance,
    threshold,
    rewardAvailable: balance >= threshold,
    updatedAt: new Date(card.updated_at).toISOString(),
  }, { headers: { "cache-control": "no-store" } });
}
