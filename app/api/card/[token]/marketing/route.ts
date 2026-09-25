import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { parseCardToken } from "@/lib/loyalty";
import { withApiErrorHandling } from "@/lib/observability";
import { enforceRateLimit } from "@/lib/rate-limit";
import { rejectCrossOrigin } from "@/lib/security";

const PRIVATE_HEADERS = { "cache-control": "no-store" };

/**
 * Le client, depuis sa propre carte (l'URL est son accès), choisit de
 * recevoir ou non les offres du commerce. C'est la personne concernée qui
 * agit : elle peut consentir comme retirer son consentement. Un e-mail est
 * nécessaire pour recevoir quoi que ce soit.
 */
async function handlePatch(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const originError = rejectCrossOrigin(req);
  if (originError) return originError;
  const limited = await enforceRateLimit(req, "card-marketing", 20, 60 * 60);
  if (limited) return limited;
  const token = parseCardToken((await params).token);
  if (!token) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404, headers: PRIVATE_HEADERS });
  const body = await req.json().catch(() => null);
  if (typeof body?.marketingConsent !== "boolean") return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400, headers: PRIVATE_HEADERS });
  const consent: boolean = body.marketingConsent;

  const result = await sql.begin(async (tx) => {
    const [customer] = await tx`
      select cu.id, cu.establishment_id, cu.email, cu.marketing_consent
      from cards c
      join customers cu on cu.id=c.customer_id
      join establishments e on e.id=c.establishment_id
      where c.token=${token} and c.active=true and cu.deleted_at is null and e.status='active'
        and (c.expires_at is null or c.expires_at > now())
      for update of cu
    `;
    if (!customer) return { error: "NOT_FOUND" as const };
    if (consent && !customer.email) return { error: "EMAIL_REQUIRED" as const };
    if (customer.marketing_consent === consent) return { consent };
    await tx`
      update customers set marketing_consent=${consent}, marketing_consent_at=${consent ? new Date() : null}, updated_at=now()
      where id=${customer.id}
    `;
    await tx`
      insert into audit_logs(establishment_id, staff_user_id, action, entity_type, entity_id, metadata)
      values(${customer.establishment_id}, null, ${consent ? "CUSTOMER_MARKETING_GRANTED" : "CUSTOMER_MARKETING_WITHDRAWN"}, 'customer', ${customer.id}, ${tx.json({ source: "customer_card" })})
    `;
    return { consent };
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.error === "NOT_FOUND" ? 404 : 400, headers: PRIVATE_HEADERS });
  }
  return NextResponse.json({ marketingConsent: result.consent }, { headers: PRIVATE_HEADERS });
}

export const PATCH = withApiErrorHandling("CARD_MARKETING", handlePatch);
