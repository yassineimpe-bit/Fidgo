import { sql } from "@/lib/db";
import { cardToken, shortCode } from "@/lib/ids";
import { isEmail } from "@/lib/input";
import { withApiErrorHandling } from "@/lib/observability";
import { consumeRateLimit } from "@/lib/rate-limit";
import { PRIVATE_HEADERS, rejectCrossOrigin, requestIp } from "@/lib/security";

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

  // 200/h laissait tout le loisir d'enumerer une base d'emails. 15/h suffit
  // largement a un commerce reel et coupe l'enumeration de masse.
  //
  // La cle porte desormais l'UUID d'un etablissement VERIFIE, plus le slug
  // brut : auparavant chaque slug inedit ouvrait un compteur neuf, ce qui
  // insérait une ligne dans `rate_limits` a chaque requete d'un anonyme.
  const rate = await consumeRateLimit(`enroll:${requestIp(req)}:${establishment.id}`, 15, 60 * 60);
  if (!rate.allowed) return Response.json({ error: "RATE_LIMITED" }, { status: 429 });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = cardToken();
    const code = shortCode();
    try {
      const outcome = await sql.begin(async (tx) => {
        // Ce verrou entre en conflit avec le FOR UPDATE des suspensions. Il
        // linearise la creation avec le lifecycle du commerce : si la
        // suspension gagne, cette lecture reprend sur l'etat courant et refuse
        // l'inscription ; si l'inscription gagne, la suspension attend puis
        // traite la carte nouvellement creee.
        const [current] = await tx`
          select e.id, p.expires_after_days
          from establishments e
          join loyalty_programs p on p.establishment_id = e.id
          where e.id = ${establishment.id}
            and e.status = 'active'
            and p.active = true
          limit 1
          for share of e, p
        `;
        if (!current) return { kind: "unavailable" } as const;

        // La detection de doublon appartient a la meme transaction que les
        // INSERT. Les index uniques restent le dernier rempart lorsque deux
        // transactions concurrentes observent simultanement l'absence.
        const [existing] = await tx`
          select u.id
          from customers u
          where u.establishment_id = ${current.id}
            and u.deleted_at is null
            and ((${email}::text is not null and lower(u.email) = lower(${email}))
              or (${phone}::text is not null and u.phone = ${phone}))
          limit 1
        `;
        if (existing) return { kind: "duplicate" } as const;

        const [customer] = await tx`
          insert into customers (establishment_id, email, phone, first_name, marketing_consent, marketing_consent_at)
          values (${current.id}, ${email}, ${phone}, ${firstName}, ${marketingConsent}, ${marketingConsent ? new Date() : null})
          returning id
        `;
        const [card] = await tx`
          insert into cards (establishment_id, customer_id, token, short_code, expires_at)
          values (
            ${current.id}, ${customer.id}, ${token}, ${code},
            case when ${current.expires_after_days}::int is null then null
                 else now() + (${current.expires_after_days}::int * interval '1 day') end
          ) returning id, token, short_code, balance
        `;
        await tx`
          insert into product_events(establishment_id, card_id, event_type)
          values(${current.id}, ${card.id}, 'JOIN_SUBMIT')
        `;
        return { kind: "created", card } as const;
      });
      if (outcome.kind === "unavailable") {
        return Response.json({ error: "ESTABLISHMENT_NOT_FOUND" }, { status: 404 });
      }
      if (outcome.kind === "duplicate") {
        // Reponse volontairement muette : on confirme au visiteur legitime
        // qu'il a deja une carte, sans livrer d'identifiant exploitable.
        return Response.json({ error: "CARD_ALREADY_EXISTS" }, { status: 409, headers: PRIVATE_HEADERS });
      }
      return Response.json(
        { token: outcome.card.token, short_code: outcome.card.short_code, balance: outcome.card.balance },
        { status: 201, headers: PRIVATE_HEADERS },
      );
    } catch (error) {
      const codeValue = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : "";
      if (codeValue !== "23505") throw error;
      // Une nouvelle transaction distingue au tour suivant le doublon client
      // d'une collision rarissime de token/code, sans lecture hors verrou.
    }
  }

  return Response.json({ error: "ENROLL_RETRY" }, { status: 503 });
}

export const POST = withApiErrorHandling("ENROLL", handlePost);
