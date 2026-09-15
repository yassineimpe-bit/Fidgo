import { after } from "next/server";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { canReverse, isValidIdempotencyKey } from "@/lib/loyalty";
import { rejectCrossOrigin } from "@/lib/security";
import { syncWalletsForCard } from "@/lib/wallet-sync";

export async function POST(req: Request) {
  const originError = rejectCrossOrigin(req);
  if (originError) return originError;
  const session = await getSession();
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!canReverse(session.role)) return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  const { transactionId, idempotencyKey } = await req.json();
  if (!transactionId || !isValidIdempotencyKey(idempotencyKey)) return Response.json({ error: "INVALID_INPUT" }, { status: 400 });

  try {
    const result = await sql.begin(async (tx) => {
      const [existing] = await tx`select card_id,balance_after from transactions where establishment_id=${session.establishmentId} and idempotency_key=${String(idempotencyKey)} limit 1`;
      if (existing) return { cardId: String(existing.card_id), balance: Number(existing.balance_after), duplicate: true };
      const [original] = await tx`
        select t.id,t.card_id,t.delta,t.unit,t.type,c.balance from transactions t join cards c on c.id=t.card_id
        where t.id=${String(transactionId)} and t.establishment_id=${session.establishmentId} for update of c
      `;
      if (!original) throw new Error("TRANSACTION_NOT_FOUND");
      if (original.type === "reversal") throw new Error("CANNOT_REVERSE_REVERSAL");
      const already = await tx`select 1 from transactions where reversed_transaction_id=${original.id} limit 1`;
      if (already.length) throw new Error("ALREADY_REVERSED");
      const delta = -Number(original.delta);
      const balance = Number(original.balance) + delta;
      if (balance < 0) throw new Error("NEGATIVE_BALANCE");
      await tx`insert into transactions(establishment_id,card_id,staff_user_id,type,delta,balance_after,unit,idempotency_key,reversed_transaction_id) values(${session.establishmentId},${original.card_id},${session.staffId},'reversal',${delta},${balance},${original.unit},${String(idempotencyKey)},${original.id})`;
      await tx`update cards set balance=${balance},updated_at=now() where id=${original.card_id}`;
      await tx`insert into audit_logs(establishment_id,staff_user_id,action,entity_type,entity_id,metadata) values(${session.establishmentId},${session.staffId},'TRANSACTION_REVERSE','transaction',${String(original.id)},${tx.json({delta,balance})})`;
      return { cardId: String(original.card_id), balance, duplicate:false };
    });
    const { cardId, ...payload } = result;
    after(() => syncWalletsForCard(cardId));
    return Response.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "ERROR";
    const status = message === "TRANSACTION_NOT_FOUND" ? 404 : message === "ALREADY_REVERSED" || message === "NEGATIVE_BALANCE" || message === "CANNOT_REVERSE_REVERSAL" ? 409 : 500;
    return Response.json({ error: message }, { status });
  }
}
