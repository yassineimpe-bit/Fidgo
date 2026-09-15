import { after } from "next/server";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { canScan, isValidIdempotencyKey, parseCardToken } from "@/lib/loyalty";
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

  try {
    const result = await sql.begin(async (tx) => {
      const [idem] = await tx`select card_id,balance_after from transactions where establishment_id=${session.establishmentId} and idempotency_key=${idempotencyKey} limit 1`;
      if (idem) return { cardId: String(idem.card_id), balance: Number(idem.balance_after), duplicate: true };
      const [card] = await tx`
        select c.id,c.balance,c.active,c.expires_at,p.reward_threshold,p.mode,p.reward_label,p.active as program_active
        from cards c join loyalty_programs p on p.establishment_id=c.establishment_id
        where c.token=${token} and c.establishment_id=${session.establishmentId} for update of c
      `;
      if (!card || !card.active || !card.program_active) throw new Error("CARD_NOT_FOUND");
      if (card.expires_at && new Date(card.expires_at) < new Date()) throw new Error("CARD_EXPIRED");
      const threshold = Number(card.reward_threshold);
      if (Number(card.balance) < threshold) throw new Error("INSUFFICIENT_BALANCE");
      const balance = Number(card.balance) - threshold;
      const unit = card.mode === "STAMPS" ? "STAMP" : "POINT";
      await tx`insert into transactions(establishment_id,card_id,staff_user_id,type,delta,balance_after,unit,idempotency_key) values(${session.establishmentId},${card.id},${session.staffId},'redeem',${-threshold},${balance},${unit},${idempotencyKey})`;
      await tx`update cards set balance=${balance},updated_at=now() where id=${card.id}`;
      await tx`insert into audit_logs(establishment_id,staff_user_id,action,entity_type,entity_id,metadata) values(${session.establishmentId},${session.staffId},'LOYALTY_REDEEM','card',${String(card.id)},${tx.json({threshold,balance})})`;
      return { cardId: String(card.id), balance, duplicate:false, rewardLabel:card.reward_label };
    });
    const { cardId, ...payload } = result;
    after(() => syncWalletsForCard(cardId));
    return Response.json({ ...payload, serverMs: Date.now() - started });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ERROR";
    const status = message === "INSUFFICIENT_BALANCE" ? 409 : message === "CARD_NOT_FOUND" ? 404 : message === "CARD_EXPIRED" ? 410 : 500;
    return Response.json({ error: message, serverMs: Date.now() - started }, { status });
  }
}
