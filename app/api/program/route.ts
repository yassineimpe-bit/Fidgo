import { getSession } from "@/lib/auth";
import { DEFAULT_COOLDOWN_SECONDS, MAX_COOLDOWN_SECONDS } from "@/lib/cooldown";
import { sql } from "@/lib/db";
import { boundedInt, boundedNumber, boundedText } from "@/lib/input";
import { canManageProgram, ledgerUnitForMode } from "@/lib/loyalty";
import { withApiErrorHandling } from "@/lib/observability";
import { normalizeUnitLabel } from "@/lib/program-units";
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
  const cooldownSeconds = boundedInt(b.cooldownSeconds, { min: 0, max: MAX_COOLDOWN_SECONDS, fallback: DEFAULT_COOLDOWN_SECONDS });
  const expiresAfterDays = b.expiresAfterDays === null || b.expiresAfterDays === "" ? null : boundedInt(b.expiresAfterDays, { min: 1, max: 3650 });

  if (!mode || !pointsRule || threshold === null || stampsPerVisit === null || pointsPerPurchase === null || pointsPerEuro === null || dailyEarnLimit === null || cooldownSeconds === null || (b.expiresAfterDays !== null && b.expiresAfterDays !== "" && expiresAfterDays === null)) {
    return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  const programName = boundedText(b.programName, 120, "Carte fidélité") || "Carte fidélité";
  const rewardLabel = boundedText(b.rewardLabel, 180, "Récompense offerte") || "Récompense offerte";
  const cardMessage = boundedText(b.cardMessage, 240) || null;

  // Libellé d'unité facultatif (migration 026). Absent du corps : inchangé.
  const unitLabelSent = "unitLabel" in b || "unitLabelPlural" in b;
  const unitLabel = normalizeUnitLabel(b.unitLabel);
  const unitLabelPlural = normalizeUnitLabel(b.unitLabelPlural);
  if (unitLabelSent && (unitLabel === undefined || unitLabelPlural === undefined || (unitLabelPlural && !unitLabel))) {
    return Response.json({ error: "INVALID_UNIT_LABEL" }, { status: 400 });
  }
  const [unitColumn] = unitLabelSent
    ? await sql`select 1 from information_schema.columns where table_schema='public' and table_name='loyalty_programs' and column_name='unit_label'`
    : [];
  if (unitLabelSent && !unitColumn && unitLabel) {
    return Response.json({ error: "UNIT_LABEL_UNAVAILABLE" }, { status: 503 });
  }

  // Notification « récompense disponible » (migration 028). Absente du corps : inchangée.
  const rewardEmailSent = "rewardEmailEnabled" in b;
  if (rewardEmailSent && typeof b.rewardEmailEnabled !== "boolean") return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
  const [rewardEmailColumn] = rewardEmailSent
    ? await sql`select 1 from information_schema.columns where table_schema='public' and table_name='loyalty_programs' and column_name='reward_email_enabled'`
    : [];
  if (rewardEmailSent && !rewardEmailColumn && b.rewardEmailEnabled) {
    return Response.json({ error: "REWARD_EMAIL_UNAVAILABLE" }, { status: 503 });
  }

  const result = await sql.begin(async (tx) => {
    // Invariant (#196) : le solde des cartes est dans l'unité du mode courant,
    // sans conversion. Changer STAMPS ↔ POINTS n'est donc permis que si aucune
    // carte n'a de solde et qu'aucune écriture n'existe dans l'ancienne unité.
    // Ordre de verrouillage : ce PATCH prend la ligne programme FOR UPDATE ; les
    // routes qui écrivent dans le ledger (credit, redeem, adjust, reverse) la
    // prennent FOR SHARE dans la même requête que la carte. Le contrôle et le
    // changement de mode sont ainsi sérialisés avec toute mutation de carte, et
    // ce PATCH ne verrouille aucune carte : pas de cycle de verrous possible.
    const [current] = await tx`select id, mode from loyalty_programs where establishment_id = ${session.establishmentId} for update`;
    if (!current) throw new Error("PROGRAM_NOT_FOUND");
    if (current.mode !== mode) {
      const [usage] = await tx`
        select
          exists(select 1 from cards where establishment_id = ${session.establishmentId} and balance > 0) as has_balance,
          exists(select 1 from transactions where establishment_id = ${session.establishmentId} and unit <> ${ledgerUnitForMode(mode)}) as has_history
      `;
      if (usage.has_balance || usage.has_history) {
        return { locked: { hasBalance: Boolean(usage.has_balance), hasHistory: Boolean(usage.has_history) } };
      }
    }
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
    if (unitLabelSent && unitColumn) {
      const [labelled] = await tx`
        update loyalty_programs set unit_label=${unitLabel ?? null}, unit_label_plural=${unitLabel ? unitLabelPlural ?? null : null}
        where id=${updated.id} returning *
      `;
      Object.assign(updated, labelled);
    }
    if (rewardEmailSent && rewardEmailColumn) {
      const [notified] = await tx`update loyalty_programs set reward_email_enabled=${b.rewardEmailEnabled === true} where id=${updated.id} returning *`;
      Object.assign(updated, notified);
    }
    if (b.onboarding === true && session.role === "OWNER") {
      await tx`update establishments set onboarding_step=3, updated_at=now() where id=${session.establishmentId} and onboarding_step=2`;
    }
    await tx`insert into audit_logs (establishment_id, staff_user_id, action, entity_type, entity_id) values (${session.establishmentId}, ${session.staffId}, 'PROGRAM_UPDATE', 'loyalty_program', ${updated.id})`;
    return { program: updated };
  });
  if ("locked" in result) {
    return Response.json({ error: "PROGRAM_MODE_LOCKED", ...result.locked }, { status: 409, headers: { "cache-control": "no-store" } });
  }
  return Response.json(result.program, { headers: { "cache-control": "no-store" } });
}

export const PATCH = withApiErrorHandling("PROGRAM_PATCH", handlePatch);
