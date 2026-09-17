import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { canManageProgram, canScan, parseCardToken } from "@/lib/loyalty";
import { withApiErrorHandling } from "@/lib/observability";
import { enforceRateLimit } from "@/lib/rate-limit";
import { rejectCrossOrigin } from "@/lib/security";

async function handlePost(req: Request) {
  const started = Date.now();
  const originError = rejectCrossOrigin(req);
  if (originError) return originError;
  const session = await getSession();
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!canScan(session.role)) return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  const limited = await enforceRateLimit(req, `scan:${session.staffId}`, 240, 60);
  if (limited) return limited;

  const { token: input } = await req.json();
  const token = parseCardToken(input);
  if (!token) return Response.json({ error: "INVALID_QR" }, { status: 400 });

  const [card] = await sql`
    select
      c.id, c.token, c.short_code, c.balance, c.active, c.expires_at, c.last_earn_at,
      u.first_name,
      p.mode, p.points_rule, p.reward_threshold, p.reward_label, p.stamps_per_visit,
      p.points_per_purchase, p.points_per_euro
    from cards c
    join customers u on u.id = c.customer_id
    join loyalty_programs p on p.establishment_id = c.establishment_id
    where c.token = ${token}
      and c.establishment_id = ${session.establishmentId}
      and u.deleted_at is null
      and p.active = true
    limit 1
  `;

  if (!card || !card.active) return Response.json({ error: "CARD_NOT_FOUND" }, { status: 404 });
  if (card.expires_at && new Date(card.expires_at) < new Date()) {
    return Response.json({ error: "CARD_EXPIRED" }, { status: 410 });
  }

  return Response.json({
    token: `LOY1:${card.token}`,
    shortCode: card.short_code,
    balance: Number(card.balance),
    lastEarnAt: card.last_earn_at ? new Date(card.last_earn_at).toISOString() : null,
    firstName: card.first_name,
    mode: card.mode,
    pointsRule: card.points_rule,
    threshold: Number(card.reward_threshold),
    rewardLabel: card.reward_label,
    defaultEarn: card.mode === "STAMPS" ? Number(card.stamps_per_visit) : Number(card.points_per_purchase),
    pointsPerEuro: Number(card.points_per_euro),
    rewardAvailable: Number(card.balance) >= Number(card.reward_threshold),
    canOverrideCooldown: canManageProgram(session.role),
    serverMs: Date.now() - started,
  }, { headers: { "cache-control": "no-store" } });
}

/**
 * Une base injoignable ou un timeout réseau au moment du scan ne doit jamais
 * remonter en page vide/500 sans corps au commerçant en plein service.
 */
export const POST = withApiErrorHandling("SCAN", handlePost);
