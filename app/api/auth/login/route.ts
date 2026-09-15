import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { sql } from "@/lib/db";
import { signSession, sessionCookie } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { requireSameOrigin } from "@/lib/security";
import { isEmail } from "@/lib/input";

export async function POST(request: Request) {
  const origin = requireSameOrigin(request);
  if (!origin.ok) return NextResponse.json({ error: origin.error }, { status: origin.status });

  const limited = await rateLimit(request, "login", 10, 15 * 60);
  if (!limited.allowed) return NextResponse.json({ error: "TOO_MANY_ATTEMPTS" }, { status: 429 });

  const body = await request.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!isEmail(email) || !password) return NextResponse.json({ error: "INVALID_CREDENTIALS" }, { status: 400 });

  const users = await sql`
    select id, establishment_id, email, password_hash, role, active
    from staff_users
    where lower(email)=${email}
    limit 1
  `;
  const user = users[0];
  if (!user || !user.active || !(await bcrypt.compare(password, user.password_hash))) {
    return NextResponse.json({ error: "INVALID_CREDENTIALS" }, { status: 401 });
  }

  const token = await signSession({ userId: user.id, establishmentId: user.establishment_id, role: user.role, email: user.email });
  const response = NextResponse.json({ ok: true, role: user.role });
  response.cookies.set(sessionCookie(token));
  return response;
}
