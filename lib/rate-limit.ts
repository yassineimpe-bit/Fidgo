import { sql } from "@/lib/db";
import { hashRateKey, requestIp } from "@/lib/security";

export async function consumeRateLimit(rawKey: string, limit: number, windowSeconds: number): Promise<{ allowed: boolean; remaining: number }> {
  const key = hashRateKey(rawKey);
  const [row] = await sql`
    insert into rate_limits (key_hash, hits, window_started_at)
    values (${key}, 1, now())
    on conflict (key_hash) do update set
      hits = case when rate_limits.window_started_at < now() - (${windowSeconds}::int * interval '1 second') then 1 else rate_limits.hits + 1 end,
      window_started_at = case when rate_limits.window_started_at < now() - (${windowSeconds}::int * interval '1 second') then now() else rate_limits.window_started_at end
    returning hits
  `;
  const hits = Number(row.hits);
  return { allowed: hits <= limit, remaining: Math.max(0, limit - hits) };
}

/** Remet un compteur a zero apres une operation legitime reussie. */
export async function resetRateLimit(rawKey: string): Promise<void> {
  await sql`delete from rate_limits where key_hash = ${hashRateKey(rawKey)}`;
}

export async function rateLimit(request: Request, scope: string, limit: number, windowSeconds: number) {
  return consumeRateLimit(`${scope}:${requestIp(request)}`, limit, windowSeconds);
}

/**
 * Garde-fou par IP a poser en tete de route. Renvoie une Response 429 prete a
 * retourner, ou null si la requete peut continuer.
 */
export async function enforceRateLimit(request: Request, scope: string, limit: number, windowSeconds: number): Promise<Response | null> {
  const { allowed } = await rateLimit(request, scope, limit, windowSeconds);
  if (allowed) return null;
  return Response.json({ error: "RATE_LIMITED" }, { status: 429, headers: { "retry-after": String(windowSeconds) } });
}

/**
 * La table rate_limits ne se purge pas toute seule : elle grossit sans limite
 * et devient un point de contention. A appeler depuis un cron quotidien
 * (Vercel Cron) ou une tache de maintenance.
 */
export async function purgeStaleRateLimits(olderThanHours = 24): Promise<number> {
  const rows = await sql`
    delete from rate_limits
    where window_started_at < now() - (${olderThanHours}::int * interval '1 hour')
    returning key_hash
  `;
  return rows.length;
}
