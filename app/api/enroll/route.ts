import { sql } from "@/lib/db";
import { cardToken, shortCode } from "@/lib/ids";
import { consumeRateLimit } from "@/lib/rate-limit";
import { rejectCrossOrigin, requestIp } from "@/lib/security";

async function findExisting(establishmentId: string, email: string | null, phone: string | null) {
  if (!email && !phone) return null;
  const [existing] = await sql`
    select c.token, c.short_code, c.balance
    from cards c
    join customers u on u.id = c.customer_id
    where u.establishment_id = ${establishmentId}
      and u.deleted_at is null
      and ((${email}::text is not null and lower(u.email) = lower(${email}))
        or (${phone}::text is not null and u.phone = ${phone}))
    limit 1
  `;
  return existing || null;
}

export async function POST(req: Request) {
  const originError = rejectCrossOrigin(req);
  if (originError) return originError;

  const body = await req.json();
  const slug = String(body.slug || "").trim();
  const email = body.email ? String(body.email).trim().toLowerCase().slice(0, 254) : null;
  const phone = body.phone ? String(body.phone).trim().slice(0, 40) : null;
  const firstName = body.firstName ? String(body.firstName).trim().slice(0, 80) : null;
  const marketingConsent = body.marketingConsent === true;

  if (!slug || (email && !/^\S+@\S+\.\S+$/.test(email))) {
    return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  const rate = await consumeRateLimit(`enroll:${requestIp(req)}:${slug}`, 200, 60 * 60);
  if (!rate.allowed) return Response.json({ error: "RATE_LIMITED" }, { status: 429 });

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

  const existing = await findExisting(establishment.id, email, phone);
  if (existing) return Response.json(existing, { headers: { "cache-control": "no-store" } });

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
          ) returning token, short_code, balance
        `;
        return card;
      });
      return Response.json(created, { status: 201, headers: { "cache-control": "no-store" } });
    } catch (error) {
      const codeValue = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : "";
      if (codeValue !== "23505") throw error;
      const raced = await findExisting(establishment.id, email, phone);
      if (raced) return Response.json(raced, { headers: { "cache-control": "no-store" } });
    }
  }

  return Response.json({ error: "ENROLL_RETRY" }, { status: 503 });
}
