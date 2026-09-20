import { after } from "next/server";
import { NextResponse } from "next/server";
import { clearedSessionCookie, getSession } from "@/lib/auth";
import { notifyAppleWalletRevocation } from "@/lib/apple-wallet";
import { sql } from "@/lib/db";
import { notifyGoogleWalletRevocation } from "@/lib/google-wallet";
import { canSuspendEstablishment } from "@/lib/loyalty";
import { withApiErrorHandling } from "@/lib/observability";
import { enforceRateLimit } from "@/lib/rate-limit";
import { PRIVATE_HEADERS, rejectCrossOrigin } from "@/lib/security";

/**
 * Fermeture défensive et volontairement non réversible depuis l'application.
 * Une réouverture exige une intervention administrateur et une réémission des
 * accès/cartes ; aucune suppression physique du ledger n'est proposée.
 */
async function handlePost(req: Request) {
  const originError = rejectCrossOrigin(req);
  if (originError) return originError;
  const session = await getSession();
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401, headers: PRIVATE_HEADERS });
  if (!canSuspendEstablishment(session.role)) {
    return Response.json({ error: "FORBIDDEN" }, { status: 403, headers: PRIVATE_HEADERS });
  }
  const limited = await enforceRateLimit(req, `establishment-suspend:${session.staffId}`, 3, 60 * 60);
  if (limited) return limited;

  const body = await req.json().catch(() => ({}));
  const confirmationSlug = String(body.confirmationSlug || "").trim();
  if (body.confirmation !== "SUSPENDRE" || !confirmationSlug) {
    return Response.json({ error: "CONFIRMATION_REQUIRED" }, { status: 400, headers: PRIVATE_HEADERS });
  }

  const cardIds = await sql.begin(async (tx) => {
    const [establishment] = await tx`
      select id,slug,status from establishments
      where id=${session.establishmentId}
      for update
    `;
    if (!establishment || establishment.status !== "active") throw new Error("ESTABLISHMENT_NOT_ACTIVE");
    if (String(establishment.slug) !== confirmationSlug) throw new Error("CONFIRMATION_MISMATCH");

    const cards = await tx`
      select id from cards where establishment_id=${session.establishmentId} for update
    `;
    await tx`update establishments set status='suspended',updated_at=now() where id=${session.establishmentId}`;
    await tx`
      update cards set
        active=false,
        token='CLOSED_' || encode(gen_random_bytes(32),'hex'),
        short_code='CLOSED-' || id::text,
        updated_at=now()
      where establishment_id=${session.establishmentId}
    `;
    await tx`
      update card_recovery_tokens set used_at=coalesce(used_at,now())
      where establishment_id=${session.establishmentId}
    `;
    await tx`
      update password_reset_tokens
      set used_at=coalesce(used_at,now())
      where staff_user_id in (
        select id from staff_users where establishment_id=${session.establishmentId}
      )
    `;
    await tx`
      update wallet_passes set status='revoked',last_error=null,updated_at=now()
      where establishment_id=${session.establishmentId}
    `;
    await tx`delete from push_subscriptions where establishment_id=${session.establishmentId}`;
    await tx`
      insert into audit_logs(establishment_id,staff_user_id,action,entity_type,entity_id,metadata)
      values(
        ${session.establishmentId},${session.staffId},'ESTABLISHMENT_SUSPEND','establishment',${session.establishmentId},
        ${tx.json({ cardsRevoked: cards.length, ledgerPreserved: true })}
      )
    `;
    await tx`
      update staff_users
      set active=false,token_version=token_version+1,updated_at=now()
      where establishment_id=${session.establishmentId}
    `;
    return cards.map((card) => String(card.id));
  }).catch((error) => {
    const message = error instanceof Error ? error.message : "ERROR";
    if (message === "CONFIRMATION_MISMATCH" || message === "ESTABLISHMENT_NOT_ACTIVE") return null;
    throw error;
  });

  if (!cardIds) return Response.json({ error: "CONFIRMATION_MISMATCH" }, { status: 409, headers: PRIVATE_HEADERS });
  if (cardIds.length) {
    after(() => Promise.allSettled(cardIds.flatMap((cardId) => [notifyAppleWalletRevocation(cardId), notifyGoogleWalletRevocation(cardId)])));
  }
  const response = NextResponse.json({ ok: true, status: "suspended" }, { headers: PRIVATE_HEADERS });
  response.cookies.set(clearedSessionCookie());
  return response;
}

export const POST = withApiErrorHandling("RESTAURANT_SUSPEND", handlePost);
