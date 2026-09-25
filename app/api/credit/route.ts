import { after } from "next/server";
import { crossedRewardThreshold, notifyRewardAvailable } from "@/lib/reward-notification";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { boundedText } from "@/lib/input";
import { canManageProgram, canScan, computeEarnDelta, isValidIdempotencyKey, parseCardToken, type LoyaltyMode, type PointsRule } from "@/lib/loyalty";
import { enforceRateLimit } from "@/lib/rate-limit";
import { rejectCrossOrigin } from "@/lib/security";
import { safeErrorCode, sanitizeAuditText, withApiErrorHandling } from "@/lib/observability";
import { syncWalletsForCard } from "@/lib/wallet-sync";

const KNOWN_CREDIT_ERRORS = new Set(["CARD_NOT_FOUND", "CARD_EXPIRED", "DAILY_LIMIT", "STALE_CARD_STATE", "INVALID_AMOUNT"]);

async function handlePost(req: Request) {
  const started = Date.now();
  const originError = rejectCrossOrigin(req);
  if (originError) return originError;
  const session = await getSession();
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!canScan(session.role)) return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  // Aucune limite n'existait sur les routes de credit/debit : un compte
  // compromis pouvait marteler l'endpoint sans plafond.
  const limited = await enforceRateLimit(req, `credit:${session.staffId}`, 120, 60);
  if (limited) return limited;

  const body = await req.json().catch(() => ({}));
  const token = parseCardToken(body.token);
  const idempotencyKey = body.idempotencyKey;
  const overrideReason = sanitizeAuditText(boundedText(body.overrideReason, 240));
  const hasExpectedLastEarnAt = Object.prototype.hasOwnProperty.call(body, "expectedLastEarnAt");
  const expectedLastEarnAt = body.expectedLastEarnAt === null
    ? null
    : typeof body.expectedLastEarnAt === "string" && Number.isFinite(Date.parse(body.expectedLastEarnAt))
      ? new Date(body.expectedLastEarnAt).getTime()
      : undefined;
  if (!token || !isValidIdempotencyKey(idempotencyKey)) return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
  if (body.overrideReason !== undefined && !overrideReason) return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
  if (overrideReason && !canManageProgram(session.role)) return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  if (overrideReason && (!hasExpectedLastEarnAt || expectedLastEarnAt === undefined)) return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
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
      if (!card) throw new Error("CARD_NOT_FOUND");

      // A concurrent retry can miss the first idempotency lookup, then wait on the
      // card row lock while the first request commits. Re-check after acquiring the
      // lock so the retry returns duplicate=true instead of incorrectly hitting cooldown.
      const [idemAfterLock] = await tx`select card_id,balance_after,delta from transactions where establishment_id=${session.establishmentId} and idempotency_key=${idempotencyKey} limit 1`;
      if (idemAfterLock) return { cardId: String(idemAfterLock.card_id), balance: Number(idemAfterLock.balance_after), delta: Number(idemAfterLock.delta), duplicate: true };

      if (!card.active || !card.program_active) throw new Error("CARD_NOT_FOUND");
      if (card.expires_at && new Date(card.expires_at) < new Date()) throw new Error("CARD_EXPIRED");
      const cooldownRemainingMs = card.last_earn_at
        ? Number(card.cooldown_seconds) * 1000 - (Date.now() - new Date(card.last_earn_at).getTime())
        : 0;
      const currentLastEarnAt = card.last_earn_at ? new Date(card.last_earn_at).getTime() : null;
      if (overrideReason && expectedLastEarnAt !== currentLastEarnAt) throw new Error("STALE_CARD_STATE");
      const overrodeCooldown = cooldownRemainingMs > 0 && Boolean(overrideReason);
      if (cooldownRemainingMs > 0 && !overrideReason) {
        throw new Error(`COOLDOWN:${Math.max(1, Math.ceil(cooldownRemainingMs / 1000))}`);
      }

      const delta = computeEarnDelta({ mode: card.mode as LoyaltyMode, pointsRule: card.points_rule as PointsRule, stampsPerVisit:Number(card.stamps_per_visit), pointsPerEuro:Number(card.points_per_euro), pointsPerPurchase:Number(card.points_per_purchase), rewardThreshold:Number(card.reward_threshold) }, { purchaseAmountCents: body.purchaseAmountCents === undefined ? undefined : purchaseAmountCents });
      if (delta <= 0) throw new Error("INVALID_AMOUNT");
      const dailyLimit = Number(card.daily_earn_limit || 0);
      if (dailyLimit > 0) {
        const [daily] = await tx`select coalesce(sum(delta),0)::int as earned from transactions where card_id=${card.id} and type='earn' and created_at >= (date_trunc('day', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris')`;
        if (Number(daily.earned) + delta > dailyLimit) throw new Error("DAILY_LIMIT");
      }

      const balance = Number(card.balance) + delta;
      const unit = card.mode === "STAMPS" ? "STAMP" : "POINT";
      const [earned] = await tx`insert into transactions(establishment_id,card_id,staff_user_id,type,delta,balance_after,unit,idempotency_key,metadata) values(${session.establishmentId},${card.id},${session.staffId},'earn',${delta},${balance},${unit},${idempotencyKey},${tx.json({purchaseAmountCents:body.purchaseAmountCents??null,pointsRule:card.points_rule,overrideReason:overrodeCooldown?overrideReason:null})}) returning id`;
      const [updatedCard] = await tx`update cards set balance=${balance},last_earn_at=now(),updated_at=now() where id=${card.id} returning last_earn_at`;
      await tx`insert into audit_logs(establishment_id,staff_user_id,action,entity_type,entity_id,metadata) values(${session.establishmentId},${session.staffId},'LOYALTY_EARN','card',${String(card.id)},${tx.json({delta,balance})})`;
      await tx`insert into product_events(establishment_id,card_id,staff_user_id,event_type,metadata) values(${session.establishmentId},${card.id},${session.staffId},'CREDIT_SUCCESS',${tx.json({delta,override:overrodeCooldown})})`;
      if (overrodeCooldown) {
        await tx`insert into audit_logs(establishment_id,staff_user_id,action,entity_type,entity_id,metadata) values(${session.establishmentId},${session.staffId},'CARD_ADJUSTED','card',${String(card.id)},${tx.json({oldBalance:Number(card.balance),newBalance:balance,delta,reason:overrideReason,source:'cooldown_override'})})`;
      }
      return { cardId: String(card.id), rewardCrossedBy: crossedRewardThreshold(Number(card.balance), balance, Number(card.reward_threshold)) ? String(earned.id) : null, balance, delta, duplicate:false, rewardAvailable: balance >= Number(card.reward_threshold), threshold:Number(card.reward_threshold), rewardLabel:card.reward_label, firstName:card.first_name, mode:card.mode, lastEarnAt: new Date(updatedCard.last_earn_at).toISOString() };
    });
    const { cardId, rewardCrossedBy, ...payload } = result as typeof result & { rewardCrossedBy?: string | null };
    after(() => syncWalletsForCard(cardId));
    if (rewardCrossedBy) after(() => notifyRewardAvailable(session.establishmentId, rewardCrossedBy));
    return Response.json({ ...payload, serverMs: Date.now() - started }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ERROR";
    const cooldown = message.startsWith("COOLDOWN:");
    const known = cooldown || KNOWN_CREDIT_ERRORS.has(message);
    // Une erreur non reconnue (base injoignable, contrainte inattendue) ne doit
    // jamais renvoyer error.message brut au client : seul un code générique
    // sort ici, le détail va en log serveur via safeErrorCode.
    if (!known) console.error("CREDIT_FAILED", { code: safeErrorCode(error, "CREDIT_FAILED") });
    const errorCode = cooldown ? "COOLDOWN" : known ? message : "CREDIT_FAILED";
    const status = cooldown || message === "DAILY_LIMIT" || message === "STALE_CARD_STATE" ? 409 : message === "CARD_NOT_FOUND" ? 404 : message === "CARD_EXPIRED" ? 410 : message === "INVALID_AMOUNT" ? 400 : 500;
    return Response.json({ error: errorCode, remainingSeconds: cooldown ? Number(message.split(":")[1]) : undefined, serverMs: Date.now() - started }, { status });
  }
}

export const POST = withApiErrorHandling("CREDIT", handlePost);
