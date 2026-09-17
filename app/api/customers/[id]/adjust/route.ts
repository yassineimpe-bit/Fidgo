import { after } from "next/server";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { boundedInt, boundedText } from "@/lib/input";
import { canManageProgram, isValidIdempotencyKey } from "@/lib/loyalty";
import { enforceRateLimit } from "@/lib/rate-limit";
import { rejectCrossOrigin } from "@/lib/security";
import { safeErrorCode, sanitizeAuditText, withApiErrorHandling } from "@/lib/observability";
import { syncWalletsForCard } from "@/lib/wallet-sync";

const KNOWN_ADJUST_ERRORS = new Set(["CARD_NOT_FOUND", "NO_CHANGE"]);

async function handlePost(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = rejectCrossOrigin(req);
  if (originError) return originError;

  const session = await getSession();
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!canManageProgram(session.role)) return Response.json({ error: "FORBIDDEN" }, { status: 403 });

  const limited = await enforceRateLimit(req, `card-adjust:${session.staffId}`, 30, 60);
  if (limited) return limited;

  const { id: customerId } = await params;
  const body = await req.json().catch(() => ({}));
  const newBalance = boundedInt(body.newBalance, { min: 0, max: 1_000_000 });
  const reason = sanitizeAuditText(boundedText(body.reason, 240));
  const idempotencyKey = body.idempotencyKey;
  if (newBalance === null || !reason || !isValidIdempotencyKey(idempotencyKey)) {
    return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  try {
    const result = await sql.begin(async (tx) => {
      const [existing] = await tx`
        select card_id, balance_after from transactions
        where establishment_id = ${session.establishmentId} and idempotency_key = ${idempotencyKey}
        limit 1
      `;
      if (existing) return { cardId: String(existing.card_id), balance: Number(existing.balance_after), duplicate: true };

      const [card] = await tx`
        select c.id, c.balance, p.mode
        from cards c
        join customers u on u.id = c.customer_id
        join loyalty_programs p on p.establishment_id = c.establishment_id
        where u.id = ${customerId}
          and c.establishment_id = ${session.establishmentId}
          and u.deleted_at is null and c.active = true
        for update of c
      `;
      if (!card) throw new Error("CARD_NOT_FOUND");

      const [existingAfterLock] = await tx`
        select card_id, balance_after from transactions
        where establishment_id = ${session.establishmentId} and idempotency_key = ${idempotencyKey}
        limit 1
      `;
      if (existingAfterLock) return { cardId: String(existingAfterLock.card_id), balance: Number(existingAfterLock.balance_after), duplicate: true };

      const oldBalance = Number(card.balance);
      const delta = newBalance - oldBalance;
      if (delta === 0) throw new Error("NO_CHANGE");
      const unit = card.mode === "STAMPS" ? "STAMP" : "POINT";

      await tx`
        insert into transactions(establishment_id, card_id, staff_user_id, type, delta, balance_after, unit, idempotency_key, metadata)
        values(${session.establishmentId}, ${card.id}, ${session.staffId}, 'adjust', ${delta}, ${newBalance}, ${unit}, ${idempotencyKey}, ${tx.json({ reason, oldBalance, newBalance })})
      `;
      await tx`update cards set balance = ${newBalance}, updated_at = now() where id = ${card.id}`;
      await tx`
        insert into audit_logs(establishment_id, staff_user_id, action, entity_type, entity_id, metadata)
        values(${session.establishmentId}, ${session.staffId}, 'CARD_ADJUSTED', 'card', ${String(card.id)}, ${tx.json({ oldBalance, newBalance, delta, reason })})
      `;
      return { cardId: String(card.id), balance: newBalance, delta, duplicate: false };
    });

    const { cardId, ...payload } = result;
    after(() => syncWalletsForCard(cardId));
    return Response.json(payload, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ERROR";
    const known = KNOWN_ADJUST_ERRORS.has(message);
    if (!known) console.error("CARD_ADJUST_FAILED", { code: safeErrorCode(error, "CARD_ADJUST_FAILED") });
    const status = message === "CARD_NOT_FOUND" ? 404 : message === "NO_CHANGE" ? 409 : 500;
    return Response.json({ error: known ? message : "CARD_ADJUST_FAILED" }, { status });
  }
}

export const POST = withApiErrorHandling("CARD_ADJUST", handlePost);
