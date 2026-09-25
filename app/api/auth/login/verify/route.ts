import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { sql } from "@/lib/db";
import { signSession, sessionCookie } from "@/lib/auth";
import { withApiErrorHandling } from "@/lib/observability";
import { consumeRateLimit, rateLimit, resetRateLimit } from "@/lib/rate-limit";
import { requireSameOrigin } from "@/lib/security";
import { MFA_PENDING_COOKIE, clearedMfaPendingCookie, consumeSecondFactor, enabledTwoFactor, verifyMfaPending } from "@/lib/two-factor";

const PRIVATE_HEADERS = { "cache-control": "no-store" };
/** Essais de code par compte et par quart d'heure : 5 × 3 codes valides sur 10^6. */
const CODE_ATTEMPTS = 5;
const CODE_WINDOW_SECONDS = 15 * 60;

function expired() {
  const response = NextResponse.json({ error: "TWO_FACTOR_EXPIRED" }, { status: 401, headers: PRIVATE_HEADERS });
  response.cookies.set(clearedMfaPendingCookie());
  return response;
}

async function handlePost(request: Request) {
  const origin = requireSameOrigin(request);
  if (!origin.ok) return NextResponse.json({ error: origin.error }, { status: origin.status, headers: PRIVATE_HEADERS });
  const pending = await verifyMfaPending((await cookies()).get(MFA_PENDING_COOKIE)?.value);
  if (!pending) return expired();

  const byIp = await rateLimit(request, "login-2fa", 20, CODE_WINDOW_SECONDS);
  if (!byIp.allowed) return NextResponse.json({ error: "TOO_MANY_ATTEMPTS" }, { status: 429, headers: PRIVATE_HEADERS });
  const byAccount = await consumeRateLimit(`login-2fa:${pending.staffId}`, CODE_ATTEMPTS, CODE_WINDOW_SECONDS);
  if (!byAccount.allowed) return NextResponse.json({ error: "TOO_MANY_ATTEMPTS" }, { status: 429, headers: PRIVATE_HEADERS });

  const body = await request.json().catch(() => ({}));
  const code = typeof body.code === "string" ? body.code : "";
  const recoveryCode = typeof body.recoveryCode === "string" ? body.recoveryCode : "";
  if ((!code && !recoveryCode) || code.length > 12 || recoveryCode.length > 24) {
    return NextResponse.json({ error: "INVALID_2FA_CODE" }, { status: 400, headers: PRIVATE_HEADERS });
  }

  // Le compte doit être resté dans l'état vérifié à l'étape mot de passe :
  // désactivation, suspension ou changement de mot de passe entre-temps
  // (token_version) invalident le jeton en attente.
  const [user] = await sql`
    select s.id, s.establishment_id, s.email, s.role, s.token_version, e.onboarding_step
    from staff_users s join establishments e on e.id=s.establishment_id
    where s.id=${pending.staffId} and s.active=true and s.email_verified_at is not null and e.status='active'
  `;
  if (!user || Number(user.token_version) !== pending.tokenVersion) return expired();
  const factor = await enabledTwoFactor(pending.staffId);
  if (!factor) return expired();

  const method = await consumeSecondFactor(pending.staffId, factor, code ? { code } : { recoveryCode });
  if (!method) return NextResponse.json({ error: "INVALID_2FA_CODE" }, { status: 401, headers: PRIVATE_HEADERS });

  await resetRateLimit(`login-2fa:${pending.staffId}`);
  await sql`
    insert into audit_logs(establishment_id, staff_user_id, action, entity_type, entity_id, metadata)
    values(${user.establishment_id}, ${user.id}, 'LOGIN_TWO_FACTOR_VERIFIED', 'staff_user', ${user.id}, ${sql.json({ method })})
  `;
  const token = await signSession({
    staffId: String(user.id),
    establishmentId: String(user.establishment_id),
    role: String(user.role) as "OWNER" | "MANAGER" | "EMPLOYEE" | "VIEWER",
    email: String(user.email),
    tokenVersion: Number(user.token_version),
  });
  const onboardingPending = String(user.role) === "OWNER" && user.onboarding_step !== null && Number(user.onboarding_step) < 5;
  const response = NextResponse.json({ ok: true, role: user.role, onboardingPending }, { headers: PRIVATE_HEADERS });
  response.cookies.set(sessionCookie(token));
  response.cookies.set(clearedMfaPendingCookie());
  return response;
}

export const POST = withApiErrorHandling("LOGIN_TWO_FACTOR", handlePost);
