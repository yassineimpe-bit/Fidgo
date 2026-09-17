import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { parseCardToken } from "@/lib/loyalty";
import { withApiErrorHandling } from "@/lib/observability";
import { enforceRateLimit } from "@/lib/rate-limit";

async function handleGet(request: Request, { params }: { params: Promise<{ token: string }> }) {
  // Route publique : sans limite, elle sert de sonde gratuite pour valider des
  // tokens en masse et de vecteur de DoS sur la base.
  const limited = await enforceRateLimit(request, "card-public", 60, 60);
  if (limited) return limited;

  const { token: input } = await params;
  const token = parseCardToken(input);
  if (!token) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const rows = await sql`
    select c.token, c.short_code, c.balance, c.expires_at, cu.first_name,
      e.name as establishment_name, p.mode, p.reward_threshold, p.reward_label
    from cards c
    join customers cu on cu.id = c.customer_id
    join establishments e on e.id = c.establishment_id
    join loyalty_programs p on p.establishment_id = e.id
    where c.token = ${token} and c.active = true and cu.deleted_at is null
      and e.status = 'active' and p.active = true
    limit 1
  `;
  if (!rows[0] || (rows[0].expires_at && new Date(rows[0].expires_at) < new Date())) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  delete rows[0].expires_at;
  return NextResponse.json(rows[0], { headers: { "cache-control": "no-store" } });
}

/**
 * Page carte client publique : une base injoignable ou un timeout réseau ne
 * doit jamais afficher une page cassée au client en dehors de toute session.
 */
export const GET = withApiErrorHandling("CARD_PUBLIC", handleGet);
