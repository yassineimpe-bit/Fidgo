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
  const from = action === "finish" ? 4 : 3;
  const next = from + 1;
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
