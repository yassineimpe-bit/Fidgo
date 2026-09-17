import { sql } from "@/lib/db";
import { parseCardToken } from "@/lib/loyalty";
import { withApiErrorHandling } from "@/lib/observability";
import { enforceRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Le token de carte transite en POST (jamais dans l'URL) : un GET aurait
 * laisse le token brut dans les journaux d'acces et les caches intermediaires
 * a chaque poll (toutes les 3 s tant que la carte reste visible).
 */
async function handlePost(request: Request) {
  const body = await request.json().catch(() => ({}));
  const token = parseCardToken(body.token);
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

/**
 * Le client rafraîchit sa carte toutes les 3 s : une base indisponible ne
 * doit jamais transformer ce polling silencieux en réponse HTML/vide.
 */
export const POST = withApiErrorHandling("CARD_STATUS", handlePost);
