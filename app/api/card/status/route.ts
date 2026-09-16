import { sql } from "@/lib/db";
import { parseCardToken } from "@/lib/loyalty";
import { enforceRateLimit } from "@/lib/rate-limit";
import { PRIVATE_HEADERS, rejectCrossOrigin } from "@/lib/security";

export const dynamic = "force-dynamic";

/**
 * Lecture légère pour l'auto-refresh de la carte client.
 *
 * Le token est volontairement transporté dans le corps du POST et jamais dans
 * le chemin de l'URL. Les access logs, breadcrumbs et métriques de route ne
 * contiennent donc pas la capacité d'accès à la carte.
 */
export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;

  const body = await request.json().catch(() => ({}));
  const token = parseCardToken(body.token);
  if (!token) return Response.json({ error: "NOT_FOUND" }, { status: 404, headers: PRIVATE_HEADERS });

  // Bucket distinct pour le polling. consumeRateLimit hache la clé avant
  // stockage, le token brut n'est donc pas conservé dans rate_limits.
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
    return Response.json({ error: "NOT_FOUND" }, { status: 404, headers: PRIVATE_HEADERS });
  }

  const balance = Number(card.balance);
  const threshold = Number(card.reward_threshold);
  return Response.json({
    balance,
    threshold,
    rewardAvailable: balance >= threshold,
    updatedAt: new Date(card.updated_at).toISOString(),
  }, { headers: PRIVATE_HEADERS });
}
