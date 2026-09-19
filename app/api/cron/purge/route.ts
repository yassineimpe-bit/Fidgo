import { timingSafeEqual } from "node:crypto";
import { databaseConfigured } from "@/lib/db";
import { withApiErrorHandling } from "@/lib/observability";
import { purgeStaleRateLimits } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * `purgeStaleRateLimits()` existait mais n'etait appelee nulle part : la table
 * `rate_limits` ne se purgeait donc jamais. Plusieurs routes non authentifiees
 * derivent leur cle d'une valeur fournie par l'appelant (token de carte, slug),
 * ce qui permettait a un anonyme d'y inserer une ligne inedite a chaque
 * requete. Ce cron ferme la fuite cote stockage ; la retention complete
 * (product_events, audit_logs, tokens, registrations Apple) reste portee par
 * `scripts/purge-data-lifecycle.mjs`, desormais planifie en CI.
 */
function authorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  // Fail closed : sans secret configure, la route reste inaccessible.
  if (!expected) return false;
  const supplied = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handleGet(request: Request) {
  if (!authorized(request)) return new Response(null, { status: 401 });
  if (!databaseConfigured) {
    return Response.json({ error: "SERVICE_UNAVAILABLE" }, { status: 503, headers: { "cache-control": "no-store" } });
  }

  const rateLimits = await purgeStaleRateLimits(48);
  return Response.json(
    { ok: true, purged: { rateLimits } },
    { headers: { "cache-control": "no-store" } },
  );
}

export const GET = withApiErrorHandling("CRON_PURGE", handleGet);
