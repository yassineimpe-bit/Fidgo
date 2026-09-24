import { sql } from "@/lib/db";
import { cardToken, shortCode } from "@/lib/ids";
import { isEmail } from "@/lib/input";
import { withApiErrorHandling } from "@/lib/observability";
import { consumeRateLimit } from "@/lib/rate-limit";
import { PRIVATE_HEADERS, rejectCrossOrigin, requestIp } from "@/lib/security";
import { getBillingAccess } from "@/lib/billing";

/**
 * Detecte un client deja inscrit SANS jamais exposer son token de carte.
 *
 * L'ancienne version renvoyait token/short_code/balance de la carte existante
 * sur une route non authentifiee : quiconque connaissait le slug public du
 * commerce et l'email d'un client recuperait sa carte, pouvait l'ajouter a son
 * propre Wallet et consommer sa recompense en caisse. C'etait aussi un oracle
 * RGPD ("cette adresse est-elle cliente de ce commerce ?").
 */
async function existingCustomerId(establishmentId: string, email: string | null, phone: string | null) {
  if (!email && !phone) return null;
  const [existing] = await sql`
    select u.id
    from customers u
    where u.establishment_id = ${establishmentId}
      and u.deleted_at is null
      and ((${email}::text is not null and lower(u.email) = lower(${email}))
        or (${phone}::text is not null and u.phone = ${phone}))
    limit 1
  `;
  return existing ? String(existing.id) : null;
}

async function handlePost(req: Request) {
  const originError = rejectCrossOrigin(req);
  if (originError) return originError;

  const body = await req.json().catch(() => ({}));
  const slug = String(body.slug || "").trim().slice(0, 60);
  const email = String(body.email || "").trim().toLowerCase().slice(0, 254);
  const phone = body.phone ? String(body.phone).trim().slice(0, 40) : null;
  const firstName = body.firstName ? String(body.firstName).trim().slice(0, 80) : null;
  const marketingConsent = body.marketingConsent === true;

  // V0 : l'email est obligatoire (recuperation de carte, contact commerce).
  // Le telephone reste facultatif.
  if (!slug || !isEmail(email)) {
    return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  // Plafond par IP SEULE en premiere ligne : son espace de cles est borne,
  // il ne peut donc ni etre contourne ni servir a gonfler `rate_limits`.
  const byIp = await consumeRateLimit(`enroll-ip:${requestIp(req)}`, 60, 60 * 60);
  if (!byIp.allowed) return Response.json({ error: "RATE_LIMITED" }, { status: 429 });

  const [establishment] = await sql`
    select e.id, e.status, p.expires_after_days
    from establishments e
    join loyalty_programs p on p.establishment_id = e.id
    where e.slug = ${slug} and p.active = true
    limit 1
  `;
  if (!establishment || establishment.status !== "active") {
    return Response.json({ error: "ESTABLISHMENT_NOT_FOUND" }, { status: 404 });
  }
  if (!(await getBillingAccess(String(establishment.id))).operational) {
    return Response.json({ error: "PROGRAM_UNAVAILABLE" }, { status: 403, headers: PRIVATE_HEADERS });
  }

  // 200/h laissait tout le loisir d'enumerer une base d'emails. 15/h suffit
  // largement a un commerce reel et coupe l'enumeration de masse.
  //
  // La cle porte desormais l'UUID d'un etablissement VERIFIE, plus le slug
  // brut : auparavant chaque slug inedit ouvrait un compteur neuf, ce qui
  // insérait une ligne dans `rate_limits` a chaque requete d'un anonyme.
  const rate = await consumeRateLimit(`enroll:${requestIp(req)}:${establishment.id}`, 15, 60 * 60);
  if (!rate.allowed) return Response.json({ error: "RATE_LIMITED" }, { status: 429 });

  if (await existingCustomerId(establishment.id, email, phone)) {
    // Reponse volontairement muette : on confirme au visiteur legitime qu'il a
    // deja une carte, sans livrer le moindre identifiant exploitable.
    return Response.json({ error: "CARD_ALREADY_EXISTS" }, { status: 409, headers: PRIVATE_HEADERS });
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = cardToken();
    const code = shortCode();
    try {
      const created = await sql.begin(async (tx) => {
        const [customer] = await tx`
          insert into customers (establishment_id, email, phone, first_name, marketing_consent, marketing_consent_at)
          values (${establishment.id}, ${email}, ${phone}, ${firstName}, ${marketingConsent}, ${marketingConsent ? new Date() : null})
          returning id
        `;
        const [card] = await tx`
          insert into cards (establishment_id, customer_id, token, short_code, expires_at)
          values (
            ${establishment.id}, ${customer.id}, ${token}, ${code},
            case when ${establishment.expires_after_days}::int is null then null
                 else now() + (${establishment.expires_after_days}::int * interval '1 day') end
          ) returning id, token, short_code, balance
        `;
        await tx`
          insert into product_events(establishment_id, card_id, event_type)
          values(${establishment.id}, ${card.id}, 'JOIN_SUBMIT')
        `;
        return card;
      });
      return Response.json({ token: created.token, short_code: created.short_code, balance: created.balance }, { status: 201, headers: PRIVATE_HEADERS });
    } catch (error) {
      const codeValue = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : "";
      if (codeValue !== "23505") throw error;
      // Course entre deux inscriptions simultanees : on refuse, sans rien divulguer.
      if (await existingCustomerId(establishment.id, email, phone)) {
        return Response.json({ error: "CARD_ALREADY_EXISTS" }, { status: 409, headers: PRIVATE_HEADERS });
      }
    }
  }

  return Response.json({ error: "ENROLL_RETRY" }, { status: 503 });
}

export const POST = withApiErrorHandling("ENROLL", handlePost);
