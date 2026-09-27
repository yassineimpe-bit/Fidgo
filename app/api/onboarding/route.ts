import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { withApiErrorHandling } from "@/lib/observability";
import { enforceRateLimit } from "@/lib/rate-limit";
import { rejectCrossOrigin } from "@/lib/security";

async function handlePost(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const session = await getSession();
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (session.role !== "OWNER") return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  const limited = await enforceRateLimit(request, `onboarding:${session.staffId}`, 30, 3600);
  if (limited) return limited;
  const body = await request.json().catch(() => null);
  const action = body?.action;
  if (action !== "team-created" && action !== "team-skip" && action !== "finish") {
    return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
  }
  // « finish » part de l'étape QR : 3 depuis que l'équipe n'est plus dans le
  // chemin critique (#151), 4 pour un onboarding commencé avant. Les actions
  // « team-* » restent acceptées pour les onglets encore ouverts sur l'ancien écran.
  const from = 3;
  const next = action === "finish" ? 5 : 4;
  const result = await sql.begin(async (tx) => {
    // Serialize retries and concurrent tabs. Never accept a tenant from the body.
    const [establishment] = await tx`select onboarding_step from establishments where id=${session.establishmentId} for update`;
    const current = Number(establishment?.onboarding_step);
    if (current < from) return { error: "STEP_NOT_READY", status: 409 };
    if (current >= next) return { ok: true, step: current };
    if (action === "team-created") {
      const [employee] = await tx`select id from staff_users where establishment_id=${session.establishmentId} and role='EMPLOYEE' and active=true limit 1`;
      if (!employee) return { error: "EMPLOYEE_REQUIRED", status: 409 };
    }
    await tx`update establishments set onboarding_step=${next}, updated_at=now() where id=${session.establishmentId}`;
    await tx`insert into audit_logs (establishment_id,staff_user_id,action,entity_type,entity_id,metadata)
      values (${session.establishmentId},${session.staffId},'ONBOARDING_ADVANCE','establishment',${session.establishmentId},${tx.json({ action, step: next })})`;
    return { ok: true, step: next };
  });
  return Response.json(result, { status: "status" in result ? result.status : 200, headers: { "cache-control": "no-store" } });
}

export const POST = withApiErrorHandling("ONBOARDING_POST", handlePost);
