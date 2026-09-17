import bcrypt from "bcryptjs";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { canManageStaff } from "@/lib/loyalty";
import { withApiErrorHandling } from "@/lib/observability";
import { rejectCrossOrigin } from "@/lib/security";

async function handleGet() {
  const session = await getSession();
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!canManageStaff(session.role)) return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  const rows = await sql`
    select id, email, role, active, created_at
    from staff_users
    where establishment_id = ${session.establishmentId}
    order by case role when 'OWNER' then 0 when 'MANAGER' then 1 when 'EMPLOYEE' then 2 else 3 end, created_at
  `;
  return Response.json(rows, { headers: { "cache-control": "no-store" } });
}

export const GET = withApiErrorHandling("EMPLOYEES_GET", handleGet);

async function handlePost(req: Request) {
  const originError = rejectCrossOrigin(req);
  if (originError) return originError;
  const session = await getSession();
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!canManageStaff(session.role)) return Response.json({ error: "FORBIDDEN" }, { status: 403 });

  const body = await req.json();
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const role = body.role === "VIEWER" ? "VIEWER" : "EMPLOYEE";
  if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 8 || password.length > 256) {
    return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  const hash = await bcrypt.hash(password, 12);
  try {
    const [employee] = await sql.begin(async (tx) => {
      const rows = await tx`
        insert into staff_users (establishment_id, email, password_hash, role)
        values (${session.establishmentId}, ${email}, ${hash}, ${role})
        returning id, email, role, active, created_at
      `;
      const employee = rows[0];
      await tx`
        insert into audit_logs (establishment_id, staff_user_id, action, entity_type, entity_id, metadata)
        values (${session.establishmentId}, ${session.staffId}, 'STAFF_CREATE', 'staff_user', ${employee.id}, ${tx.json({ role })})
      `;
      return rows;
    });
    return Response.json(employee, { status: 201 });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : "";
    if (code === "23505") return Response.json({ error: "EMAIL_ALREADY_USED" }, { status: 409 });
    throw error;
  }
}

export const POST = withApiErrorHandling("EMPLOYEES_POST", handlePost);
