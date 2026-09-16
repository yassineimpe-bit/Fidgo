import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { sql } from "@/lib/db";
import { signSession, sessionCookie } from "@/lib/auth";
import { consumeRateLimit, rateLimit } from "@/lib/rate-limit";
import { requireSameOrigin } from "@/lib/security";
import { isEmail } from "@/lib/input";

/**
 * Hash factice (mot de passe aleatoire, meme cout que la production) compare
 * quand le compte n'existe pas ou est desactive. Sans lui, la reponse revenait
 * en ~2 ms au lieu de ~300 ms et permettait d'enumerer les comptes au timing.
 */
const DUMMY_HASH = "$2a$12$C6UzMDM.H6dfI/f/IKcEe.7jbm1Av7B9VrPX1i8EQnE6ZBqJfFqcO";

export async function POST(request: Request) {
  const origin = requireSameOrigin(request);
  if (!origin.ok) return NextResponse.json({ error: origin.error }, { status: origin.status });

  const body = await request.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");

  const byIp = await rateLimit(request, "login", 10, 15 * 60);
  if (!byIp.allowed) return NextResponse.json({ error: "TOO_MANY_ATTEMPTS" }, { status: 429 });

  // Second compteur par compte : sans lui, un brute-force distribue sur
  // plusieurs IP contourne entierement la limite par IP.
  if (isEmail(email)) {
    const byAccount = await consumeRateLimit(`login-account:${email}`, 20, 15 * 60);
    if (!byAccount.allowed) return NextResponse.json({ error: "TOO_MANY_ATTEMPTS" }, { status: 429 });
  }

  if (!isEmail(email) || !password || password.length > 256) {
    return NextResponse.json({ error: "INVALID_CREDENTIALS" }, { status: 400 });
  }

  try {
    const users = await sql`select id, establishment_id, email, password_hash, role, active, token_version from staff_users where lower(email)=${email} limit 1`;
    const user = users[0];
    const hash = user?.active ? String(user.password_hash) : DUMMY_HASH;
    const passwordOk = await bcrypt.compare(password, hash);
    if (!user || !user.active || !passwordOk) {
      return NextResponse.json({ error: "INVALID_CREDENTIALS" }, { status: 401 });
    }

    const token = await signSession({
      staffId: String(user.id),
      establishmentId: String(user.establishment_id),
      role: String(user.role) as "OWNER" | "MANAGER" | "EMPLOYEE" | "VIEWER",
      email: String(user.email),
      tokenVersion: Number(user.token_version),
    });
    const response = NextResponse.json({ ok: true, role: user.role }, { headers: { "cache-control": "no-store" } });
    response.cookies.set(sessionCookie(token));
    return response;
  } catch (error) {
    // Meme logique que /api/auth/signup : ne jamais laisser une exception
    // (base injoignable, schema desynchronise) remonter sans corps JSON.
    console.error("LOGIN_FAILED", error);
    return NextResponse.json({ error: "LOGIN_FAILED" }, { status: 500 });
  }
}
