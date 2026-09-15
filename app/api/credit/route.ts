import { after } from "next/server";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { canScan, computeEarnDelta, isValidIdempotencyKey, parseCardToken, type LoyaltyMode, type PointsRule } from "@/lib/loyalty";
import { rejectCrossOrigin } from "@/lib/security";
import { syncWalletsForCard } from "@/lib/wallet-sync";

export async function POST(req: Request) {
  const started = Date.now();
  const originError = rejectCrossOrigin(req);
  if (originError) return originError;
  const session = await getSession();
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!canScan(session.role)) return Response.json({ error: "FORBIDDEN" }, { status: 403 });

  const body = await req.json();
  const token = parseCardToken(body.token);
  const idempotencyKey = body.idempotencyKey;
  if (!token || !isValidIdempotencyKey(idempotencyKey)) return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
  const purchaseAmountCents = Number(body.purchaseAmountCents);
  if (body.purchaseAmountCents !== undefined && (!Number.isInteger(purchaseAmountCents) || purchaseAmountCents <= 0 || purchaseAmountCents > 10_000_000)) return Response.json({ error: "INVALID_AMOUNT" }, { status: 400 });

  try {
    const result = await sql.begin(async (tx) => {
      const [idem] = await tx`select card_id,balance_after,delta from transactions where establishment_id=${session.establishmentId} and idempotency_key=${idempotencyKey} limit 1`;
      if (idem) return { cardId: String(idem.card_id), balance: Number(idem.balance_after), delta: Number(idem.delta), duplicate: true };

      const [card] = await tx`
        select c.id,c.balance,c.last_earn_at,c.active,c.expires_at,u.first_name,
          p.mode,p.points_rule,p.reward_threshold,p.reward_label,p.stamps_per_visit,
          p.points_per_euro,p.points_per_purchase,p.daily_earn_limit,p.cooldown_seconds,p.active as program_active
        from cards c join loyalty_programs p on p.establishment_id=c.establishment_id join customers u on u.id=c.customer_id
        where c.token=${token} and c.establishment_id=${session.establishmentId} and u.deleted_at is null for update of c
      `;
      if (!card || !card.active || !card.program_active) throw new Error("CARD_NOT_FOUND");
      if (card.expires_at && new Date(card.expires_at) < new Date()) throw new Error("CARD_EXPIRED");
      if (card.last_earn_at && Date.now() - new Date(card.last_earn_at).getTime() < Number(card.cooldown_seconds) * 1000) throw new Error("COOLDOWN");

      const delta = computeEarnDelta({ mode: card.mode as LoyaltyMode, pointsRule: card.points_rule as PointsRule, stampsPerVisit:Number(card.stamps_per_visit), pointsPerEuro:Number(card.points_per_euro), pointsPerPurchase:Number(card.points_per_purchase), rewardThreshold:Number(card.reward_threshold) }, { purchaseAmountCents: body.purchaseAmountCents === undefined ? undefined : purchaseAmountCents });
      if (delta <= 0) throw new Error("INVALID_AMOUNT");
      const dailyLimit = Number(card.daily_earn_limit || 0);
      if (dailyLimit > 0) {
        const [daily] = await tx`select coalesce(sum(delta),0)::int as earned from transactions where card_id=${card.id} and type='earn' and created_at >= (date_trunc('day', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris')`;
        if (Number(daily.earned) + delta > dailyLimit) throw new Error("DAILY_LIMIT");
      }

      const balance = Number(card.balance) + delta;
      const unit = card.mode === "STAMPS" ? "STAMP" : "POINT";
      await tx`insert into transactions(establishment_id,card_id,staff_user_id,type,delta,balance_after,unit,idempotency_key,metadata) values(${session.establishmentId},${card.id},${session.staffId},'earn',${delta},${balance},${unit},${idempotencyKey},${tx.json({purchaseAmountCents:body.purchaseAmountCents??null,pointsRule:card.points_rule})})`;
      await tx`update cards set balance=${balance},last_earn_at=now(),updated_at=now() where id=${card.id}`;
      await tx`insert into audit_logs(establishment_id,staff_user_id,action,entity_type,entity_id,metadata) values(${session.establishmentId},${session.staffId},'LOYALTY_EARN','card',${String(card.id)},${tx.json({delta,balance})})`;
      return { cardId: String(card.id), balance, delta, duplicate:false, rewardAvailable: balance >= Number(card.reward_threshold), threshold:Number(card.reward_threshold), rewardLabel:card.reward_label, firstName:card.first_name, mode:card.mode };
    });
    const { cardId, ...payload } = result;
    after(() => syncWalletsForCard(cardId));
    return Response.json({ ...payload, serverMs: Date.now() - started }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ERROR";
    const status = message === "COOLDOWN" || message === "DAILY_LIMIT" ? 409 : message === "CARD_NOT_FOUND" ? 404 : message === "CARD_EXPIRED" ? 410 : message === "INVALID_AMOUNT" ? 400 : 500;
    return Response.json({ error: message, serverMs: Date.now() - started }, { status });
  }
}
