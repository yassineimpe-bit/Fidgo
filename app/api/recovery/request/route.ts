import { after } from "next/server";
import { createCardRecoveryToken } from "@/lib/card-recovery";
import { sql } from "@/lib/db";
import { sendCardRecoveryEmail } from "@/lib/email";
import { isEmail } from "@/lib/input";
import { getAppUrl } from "@/lib/app-url";
import { consumeRateLimit } from "@/lib/rate-limit";
import { PRIVATE_HEADERS, rejectCrossOrigin, requestIp } from "@/lib/security";

const GENERIC_RESPONSE = {
  ok: true,
  message: "Si une carte correspond à cette adresse, un lien de récupération va être envoyé.",
};

export async function POST(req: Request) {
  const originError = rejectCrossOrigin(req);
  if (originError) return originError;

  const body = await req.json().catch(() => ({}));
  const slug = String(body.slug || "").trim().slice(0, 60);
  const email = String(body.email || "").trim().toLowerCase().slice(0, 254);
  if (!slug || !isEmail(email)) {
    return Response.json({ error: "INVALID_INPUT" }, { status: 400, headers: PRIVATE_HEADERS });
  }

  const byIp = await consumeRateLimit(`recovery-ip:${requestIp(req)}:${slug}`, 10, 60 * 60);
  const byAddress = await consumeRateLimit(`recovery-email:${slug}:${email}`, 5, 60 * 60);
  if (!byIp.allowed || !byAddress.allowed) {
    return Response.json(GENERIC_RESPONSE, { status: 202, headers: PRIVATE_HEADERS });
  }

  const [card] = await sql`
    select c.id as card_id, c.establishment_id, e.name as restaurant_name
    from cards c
    join customers u on u.id = c.customer_id
    join establishments e on e.id = c.establishment_id
    join loyalty_programs p on p.establishment_id = e.id
    where e.slug = ${slug}
      and e.status = 'active'
      and p.active = true
      and c.active = true
      and u.deleted_at is null
      and lower(u.email) = lower(${email})
    limit 1
  `;

  // Always answer the same way when no card exists. This route must not become
  // the email-enumeration oracle that /api/enroll was hardened to remove.
  if (!card) return Response.json(GENERIC_RESPONSE, { status: 202, headers: PRIVATE_HEADERS });

  const recovery = createCardRecoveryToken();
  try {
    await sql.begin(async (tx) => {
      // Only the newest recovery email remains usable. This also limits the blast
      // radius if a user requests several links and an old email is later exposed.
      await tx`
        update card_recovery_tokens
        set used_at = now()
        where card_id = ${card.card_id} and used_at is null
      `;
      await tx`
        insert into card_recovery_tokens(establishment_id, card_id, token_hash, expires_at)
        values(${card.establishment_id}, ${card.card_id}, ${recovery.tokenHash}, ${recovery.expiresAt})
      `;
    });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
    // A deployment can briefly precede its migration. Returning the exact same
    // 202 avoids turning migration state into a card-existence oracle.
    if (code === "42P01") {
      return Response.json(GENERIC_RESPONSE, { status: 202, headers: PRIVATE_HEADERS });
    }
    throw error;
  }

  const base = getAppUrl();
  if (base) {
    const recoveryUrl = `${base}/recover/${recovery.token}`;
    after(async () => {
      try {
        await sendCardRecoveryEmail({
          to: email,
          restaurantName: String(card.restaurant_name),
          recoveryUrl,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "EMAIL_SEND_FAILED";
        console.error("Card recovery email delivery failed", { code: message });
        try {
          await sql`
            insert into audit_logs(establishment_id, action, entity_type, entity_id, metadata)
            values(${card.establishment_id}, 'CARD_RECOVERY_EMAIL_FAILED', 'card', ${String(card.card_id)}, ${sql.json({ code: message.slice(0, 120) })})
          `;
        } catch {}
      }
    });
  }

  return Response.json(GENERIC_RESPONSE, { status: 202, headers: PRIVATE_HEADERS });
}
