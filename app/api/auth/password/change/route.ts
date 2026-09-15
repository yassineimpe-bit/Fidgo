import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { getSession, sessionCookie, signSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { consumeRateLimit } from "@/lib/rate-limit";
import { PRIVATE_HEADERS, rejectCrossOrigin, requestIp } from "@/lib/security";

export async function POST(req: Request) {
  const originError = rejectCrossOrigin(req);
  if (originError) return originError;

  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers: PRIVATE_HEADERS });

  const limited = await consumeRateLimit(`password-change:${session.staffId}:${requestIp(req)}`, 10, 15 * 60);
  if (!limited.allowed) {
    return NextResponse.json({ error: "TOO_MANY_ATTEMPTS" }, { status: 429, headers: PRIVATE_HEADERS });
  }

  const body = await req.json().catch(() => ({}));
  const currentPassword = String(body.currentPassword || "");
  const newPassword = String(body.newPassword || "");
  if (!currentPassword || newPassword.length < 8 || newPassword.length > 256) {
    return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400, headers: PRIVATE_HEADERS });
  }

  const [user] = await sql`select password_hash from staff_users where id = ${session.staffId} and establishment_id = ${session.establishmentId} limit 1`;
  const currentOk = user && await bcrypt.compare(currentPassword, String(user.password_hash));
  if (!currentOk) return NextResponse.json({ error: "INVALID_CURRENT_PASSWORD" }, { status: 401, headers: PRIVATE_HEADERS });

  const passwordHash = await bcrypt.hash(newPassword, 12);
  const [updated] = await sql.begin(async (tx) => {
    const rows = await tx`
      update staff_users
      set password_hash = ${passwordHash}, token_version = token_version + 1, updated_at = now()
      where id = ${session.staffId} and establishment_id = ${session.establishmentId}
      returning token_version
    `;
    await tx`
      insert into audit_logs(establishment_id, staff_user_id, action, entity_type, entity_id)
      values(${session.establishmentId}, ${session.staffId}, 'STAFF_PASSWORD_CHANGED', 'staff_user', ${session.staffId})
    `;
    return rows;
  });

  // token_version vient d'être incrémenté : sans re-signer, ce même appel
  // invaliderait sa propre session au prochain getSession().
  const token = await signSession({ ...session, tokenVersion: Number(updated.token_version) });
  const response = NextResponse.json({ ok: true }, { headers: PRIVATE_HEADERS });
  response.cookies.set(sessionCookie(token));
  return response;
}
