import { NextResponse } from "next/server";
import { clearedSessionCookie, getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { requireSameOrigin } from "@/lib/security";

export async function POST(request: Request) {
  const origin = requireSameOrigin(request);
  if (!origin.ok) return NextResponse.json({ error: origin.error }, { status: origin.status });

  const session = await getSession();
  if (session) {
    await sql.begin(async (tx) => {
      await tx`
        update staff_users
        set token_version = token_version + 1, updated_at = now()
        where id = ${session.staffId} and establishment_id = ${session.establishmentId}
      `;
      await tx`
        insert into audit_logs(establishment_id, staff_user_id, action, entity_type, entity_id)
        values(${session.establishmentId}, ${session.staffId}, 'STAFF_LOGOUT_REVOKE', 'staff_user', ${session.staffId})
      `;
    });
  }

  const response = NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  response.cookies.set(clearedSessionCookie());
  return response;
}
