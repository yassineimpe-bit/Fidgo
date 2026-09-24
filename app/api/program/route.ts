import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { boundedInt, boundedNumber, boundedText } from "@/lib/input";
import { canManageProgram } from "@/lib/loyalty";
import { withApiErrorHandling } from "@/lib/observability";
import { enforceRateLimit } from "@/lib/rate-limit";
import { rejectCrossOrigin } from "@/lib/security";

async function handleGet() {
  const session = await getSession();
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const [program] = await sql`select * from loyalty_programs where establishment_id = ${session.establishmentId}`;
  return Response.json(program, { headers: { "cache-control": "no-store" } });
}

export const GET = withApiErrorHandling("PROGRAM_GET", handleGet);

async function handlePatch(req: Request) {
  const originError = rejectCrossOrigin(req);
  if (originError) return originError;
  const session = await getSession();
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!canManageProgram(session.role)) return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  const limited = await enforceRateLimit(req, `program-patch:${session.staffId}`, 30, 60 * 60);
  if (limited) return limited;

  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
  const b = body as Record<string, unknown>;
  const mode = b.mode === "POINTS" ? "POINTS" : b.mode === "STAMPS" ? "STAMPS" : null;
  const pointsRule = b.pointsRule === "PER_EURO" ? "PER_EURO" : b.pointsRule === "PER_PURCHASE" ? "PER_PURCHASE" : null;
  const threshold = boundedInt(b.rewardThreshold, { min: 1, max: 100_000 });
  const stampsPerVisit = boundedInt(b.stampsPerVisit, { min: 1, max: 100 });
  const pointsPerPurchase = boundedInt(b.pointsPerPurchase, { min: 1, max: 100_000 });
  const pointsPerEuro = boundedNumber(b.pointsPerEuro, { min: 0.01, max: 10_000 });
  const dailyEarnLimit = boundedInt(b.dailyEarnLimit, { min: 0, max: 1_000_000, fallback: 0 });
  const cooldownSeconds = boundedInt(b.cooldownSeconds, { min: 0, max: 86_400, fallback: 120 });
  const expiresAfterDays = b.expiresAfterDays === null || b.expiresAfterDays === "" ? null : boundedInt(b.expiresAfterDays, { min: 1, max: 3650 });

  if (!mode || !pointsRule || threshold === null || stampsPerVisit === null || pointsPerPurchase === null || pointsPerEuro === null || dailyEarnLimit === null || cooldownSeconds === null || (b.expiresAfterDays !== null && b.expiresAfterDays !== "" && expiresAfterDays === null)) {
    return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  const programName = boundedText(b.programName, 120, "Carte fidélité") || "Carte fidélité";
  const rewardLabel = boundedText(b.rewardLabel, 180, "Récompense offerte") || "Récompense offerte";
  const cardMessage = boundedText(b.cardMessage, 240) || null;

  const program = await sql.begin(async (tx) => {
    const [updated] = await tx`
      update loyalty_programs set
        program_name = ${programName}, mode = ${mode}, points_rule = ${pointsRule},
        reward_threshold = ${threshold}, reward_label = ${rewardLabel}, stamps_per_visit = ${stampsPerVisit},
        points_per_purchase = ${pointsPerPurchase}, points_per_euro = ${pointsPerEuro},
        daily_earn_limit = ${dailyEarnLimit}, cooldown_seconds = ${cooldownSeconds},
        expires_after_days = ${expiresAfterDays}, card_message = ${cardMessage}, updated_at = now()
      where establishment_id = ${session.establishmentId}
      returning *
    `;
    if (!updated) throw new Error("PROGRAM_NOT_FOUND");
    if (b.onboarding === true && session.role === "OWNER") {
      await tx`update establishments set onboarding_step=3, updated_at=now() where id=${session.establishmentId} and onboarding_step=2`;
    }
    await tx`insert into audit_logs (establishment_id, staff_user_id, action, entity_type, entity_id) values (${session.establishmentId}, ${session.staffId}, 'PROGRAM_UPDATE', 'loyalty_program', ${updated.id})`;
    return updated;
  });
  return Response.json(program, { headers: { "cache-control": "no-store" } });
}

export const PATCH = withApiErrorHandling("PROGRAM_PATCH", handlePatch);
