import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { clearedSessionCookie, getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { withApiErrorHandling } from "@/lib/observability";
import { rateLimit } from "@/lib/rate-limit";
import { PRIVATE_HEADERS, rejectCrossOrigin } from "@/lib/security";

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_BYTES = 72;

function validPassword(value: string) {
  return value.length >= MIN_PASSWORD_LENGTH
    && new TextEncoder().encode(value).length <= MAX_PASSWORD_BYTES;
}

async function handlePost(req: Request) {
  const originError = rejectCrossOrigin(req);
  if (originError) return originError;

  const session = await getSession();
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401, headers: PRIVATE_HEADERS });

  const limited = await rateLimit(req, `change-password:${session.staffId}`, 8, 60 * 60);
  if (!limited.allowed) {
    return Response.json({ error: "TOO_MANY_ATTEMPTS" }, { status: 429, headers: PRIVATE_HEADERS });
  }

  const body = await req.json().catch(() => ({}));
  const currentPassword = String(body.currentPassword || "");
  const newPassword = String(body.newPassword || "");
  if (!currentPassword || currentPassword.length > 256 || !validPassword(newPassword)) {
    return Response.json({ error: "INVALID_INPUT" }, { status: 400, headers: PRIVATE_HEADERS });
  }

  const [staff] = await sql`
    select password_hash
    from staff_users
    where id=${session.staffId}
      and establishment_id=${session.establishmentId}
      and active=true
    limit 1
  `;
  if (!staff) return Response.json({ error: "UNAUTHORIZED" }, { status: 401, headers: PRIVATE_HEADERS });

  const previousHash = String(staff.password_hash);
  const currentOk = await bcrypt.compare(currentPassword, previousHash);
  if (!currentOk) {
    return Response.json({ error: "INVALID_CURRENT_PASSWORD" }, { status: 401, headers: PRIVATE_HEADERS });
  }
  if (await bcrypt.compare(newPassword, previousHash)) {
    return Response.json({ error: "SAME_PASSWORD" }, { status: 409, headers: PRIVATE_HEADERS });
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  const changed = await sql.begin(async (tx) => {
    const [updated] = await tx`
      update staff_users
      set password_hash=${newHash},token_version=token_version+1,updated_at=now()
      where id=${session.staffId}
        and establishment_id=${session.establishmentId}
        and password_hash=${previousHash}
      returning id
    `;
    if (!updated) return false;

    await tx`
      update password_reset_tokens
      set used_at=coalesce(used_at,now())
      where staff_user_id=${session.staffId}
        and used_at is null
    `;
    await tx`
      insert into audit_logs(establishment_id,staff_user_id,action,entity_type,entity_id)
      values(${session.establishmentId},${session.staffId},'PASSWORD_CHANGED','staff_user',${session.staffId})
    `;
    return true;
  });

  if (!changed) {
    return Response.json({ error: "PASSWORD_CHANGED_CONCURRENTLY" }, { status: 409, headers: PRIVATE_HEADERS });
  }

  const response = NextResponse.json({ ok: true }, { headers: PRIVATE_HEADERS });
  response.cookies.set(clearedSessionCookie());
  return response;
}

export const POST = withApiErrorHandling("CHANGE_PASSWORD", handlePost);
