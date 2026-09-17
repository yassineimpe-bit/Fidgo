import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { boundedInt, boundedText } from "@/lib/input";
import { withApiErrorHandling } from "@/lib/observability";
import { consumeRateLimit } from "@/lib/rate-limit";
import { rejectCrossOrigin, requestIp } from "@/lib/security";

const STAFF_EVENTS = new Set([
  "CAMERA_START",
  "CAMERA_READY",
  "CAMERA_FAILED",
  "QR_DETECTED",
  "SCAN_SENT",
  "SCAN_SUCCESS",
  "SCAN_FAILED",
]);

async function handlePost(req: Request) {
  const originError = rejectCrossOrigin(req);
  if (originError) return originError;
  const body = await req.json().catch(() => ({}));
  const eventType = String(body.eventType || "");

  if (eventType === "JOIN_PAGE_VIEW") {
    const slug = boundedText(body.slug, 60);
    if (!slug) return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
    const rate = await consumeRateLimit(`event-join-view:${requestIp(req)}:${slug}`, 120, 60 * 60);
    if (!rate.allowed) return Response.json({ error: "RATE_LIMITED" }, { status: 429 });
    const [establishment] = await sql`select id from establishments where slug = ${slug} and status = 'active' limit 1`;
    if (!establishment) return Response.json({ ok: true }, { status: 202 });
    await sql`insert into product_events(establishment_id, event_type) values(${establishment.id}, 'JOIN_PAGE_VIEW')`;
    return Response.json({ ok: true }, { status: 202 });
  }

  const session = await getSession();
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!STAFF_EVENTS.has(eventType)) return Response.json({ error: "INVALID_INPUT" }, { status: 400 });

  const rate = await consumeRateLimit(`event-staff:${session.staffId}`, 300, 60);
  if (!rate.allowed) return Response.json({ error: "RATE_LIMITED" }, { status: 429 });
  const durationMs = boundedInt(body.durationMs, { min: 0, max: 60_000 });
  if (durationMs === null) return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
  const source = body.source === "manual" ? "manual" : "qr";
  const errorCode = eventType === "SCAN_FAILED" || eventType === "CAMERA_FAILED"
    ? boundedText(body.errorCode, 64) || "ERROR"
    : null;

  await sql`
    insert into product_events(establishment_id, staff_user_id, event_type, duration_ms, metadata)
    values(${session.establishmentId}, ${session.staffId}, ${eventType}, ${durationMs}, ${sql.json({ source, errorCode })})
  `;
  return Response.json({ ok: true }, { status: 202 });
}

export const POST = withApiErrorHandling("EVENTS", handlePost);
