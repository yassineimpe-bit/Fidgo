import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { databaseConfigured, sql } from "@/lib/db";
import { signSession, sessionCookie } from "@/lib/auth";
import { consumeRateLimit, rateLimit, resetRateLimit } from "@/lib/rate-limit";
import { hashRateKey, requireSameOrigin } from "@/lib/security";
import { isEmail } from "@/lib/input";
import { safeErrorCode } from "@/lib/observability";
import { createPhaseTimer } from "@/lib/phase-timer";
import { enabledTwoFactor, mfaPendingCookie, signMfaPending } from "@/lib/two-factor";

/**
 * Hash factice (mot de passe aleatoire, meme cout que la production) compare
 * quand le compte n'existe pas ou est desactive. Sans lui, la reponse revenait
 * en ~2 ms au lieu de ~300 ms et permettait d'enumerer les comptes au timing.
 */
const DUMMY_HASH = "$2a$12$C6UzMDM.H6dfI/f/IKcEe.7jbm1Av7B9VrPX1i8EQnE6ZBqJfFqcO";

const ACCOUNT_ATTEMPT_LIMIT = 20;
const ACCOUNT_WINDOW_SECONDS = 15 * 60;

export async function POST(request: Request) {
  // Diagnostic de latence (LOGIN_TIMING_LOG=1) : journaux serveur uniquement.
  const timer = createPhaseTimer("LOGIN_TIMING");
  const origin = requireSameOrigin(request);
  if (!origin.ok) return NextResponse.json({ error: origin.error }, { status: origin.status });

  if (!databaseConfigured || !process.env.AUTH_SECRET?.trim()) {
    return NextResponse.json(
      { error: "SERVICE_UNAVAILABLE" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  const body = await request.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  timer.lap("parseMs");

  const byIp = await rateLimit(request, "login", 10, 15 * 60);
  timer.lap("rateLimitMs");
  if (!byIp.allowed) {
    timer.done("ip_throttled");
    return NextResponse.json({ error: "TOO_MANY_ATTEMPTS" }, { status: 429 });
  }

  // Second compteur par compte : sans lui, un brute-force distribue sur
  // plusieurs IP contourne entierement la limite par IP.
  //
  // Il n'est plus consulte AVANT la verification du mot de passe. Un blocage
  // en amont transformait ce garde-fou en arme : 20 requetes suffisaient pour
  // empecher un commercant de se connecter pendant 15 minutes, en connaissant
  // seulement son email — et une caisse bloquee en plein service est un degat
  // bien plus concret que les tentatives qu'on cherchait a freiner. Le
  // compteur gouverne desormais les ECHECS, pas l'acces : un mot de passe
  // correct passe toujours (cf. plus bas).
  const accountKey = `login-account:${email}`;

  if (!isEmail(email) || !password || password.length > 256) {
    timer.done("invalid_input");
    return NextResponse.json({ error: "INVALID_CREDENTIALS" }, { status: 400 });
  }

  try {
    const users = await sql`
      select id, establishment_id, email, password_hash, role, active, token_version, email_verified_at
      from staff_users
      where lower(email)=${email}
      limit 1
    `;
    const user = users[0];
    timer.lap("dbLookupMs");
    const hash = user?.active ? String(user.password_hash) : DUMMY_HASH;
    const passwordOk = await bcrypt.compare(password, hash);
    timer.lap("bcryptMs");

    if (!user || !user.active || !passwordOk) {
      // Seul l'echec consomme un jeton.
      const { allowed } = await consumeRateLimit(accountKey, ACCOUNT_ATTEMPT_LIMIT, ACCOUNT_WINDOW_SECONDS);
      timer.lap("accountLimitMs");
      timer.done(allowed ? "invalid_credentials" : "account_throttled");
      if (!allowed) {
        // Compensation du blocage retire : l'acharnement sur un compte devient
        // un signal exploitable dans les logs, sans journaliser l'adresse.
        console.warn("LOGIN_ACCOUNT_THROTTLED", { account: hashRateKey(email).slice(0, 12) });
        return NextResponse.json({ error: "TOO_MANY_ATTEMPTS" }, { status: 429 });
      }
      return NextResponse.json({ error: "INVALID_CREDENTIALS" }, { status: 401 });
    }

    // On ne révèle les états de compte (suspendu, e-mail non vérifié)
    // qu'après preuve du mot de passe : aucun signal d'énumération. Aucune
    // session n'est émise pour un commerce suspendu.
    const [establishment] = await sql`
      select status, onboarding_step from establishments where id=${user.establishment_id}
    `;
    timer.lap("establishmentMs");
    if (establishment?.status !== "active") {
      timer.done("establishment_suspended");
      return NextResponse.json(
        { error: "ESTABLISHMENT_SUSPENDED" },
        { status: 403, headers: { "cache-control": "no-store" } },
      );
    }

    // Le titulaire legitime repart d'un compteur vierge. Combine au fait qu'un
    // mot de passe correct n'est jamais rejete, il ne peut plus etre maintenu
    // dehors par les tentatives d'un tiers.
    await resetRateLimit(accountKey);
    timer.lap("rateLimitResetMs");

    if (!user.email_verified_at) {
      timer.done("email_not_verified");
      return NextResponse.json(
        { error: "EMAIL_NOT_VERIFIED" },
        { status: 403, headers: { "cache-control": "no-store" } },
      );
    }

    // Second facteur actif : aucune session tant que le code n'est pas
    // vérifié par /api/auth/login/verify. Révélé seulement après le mot de passe.
    if (await enabledTwoFactor(String(user.id))) {
      const pending = await signMfaPending(String(user.id), Number(user.token_version));
      const response = NextResponse.json({ twoFactorRequired: true }, { headers: { "cache-control": "no-store" } });
      response.cookies.set(mfaPendingCookie(pending));
      timer.done("two_factor_required");
      return response;
    }

    const token = await signSession({
      staffId: String(user.id),
      establishmentId: String(user.establishment_id),
      role: String(user.role) as "OWNER" | "MANAGER" | "EMPLOYEE" | "VIEWER",
      email: String(user.email),
      tokenVersion: Number(user.token_version),
    });
    timer.lap("sessionSignMs");
    // Même règle que le dashboard : un OWNER dont la configuration guidée est
    // en cours y retourne directement (NULL = commerce historique, terminé).
    const onboardingPending = String(user.role) === "OWNER"
      && establishment.onboarding_step !== null
      && Number(establishment.onboarding_step) < 5;
    const response = NextResponse.json(
      { ok: true, role: user.role, onboardingPending },
      { headers: { "cache-control": "no-store" } },
    );
    response.cookies.set(sessionCookie(token));
    timer.done("success");
    return response;
  } catch (error) {
    // Meme logique que /api/auth/signup : ne jamais laisser une exception
    // (base injoignable, schema desynchronise) remonter sans corps JSON.
    console.error("LOGIN_FAILED", { code: safeErrorCode(error, "LOGIN_FAILED") });
    timer.done("error");
    return NextResponse.json({ error: "LOGIN_FAILED" }, { status: 500 });
  }
}
