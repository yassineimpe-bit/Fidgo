import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import {
  canAssignStaffRole,
  canManageStaff,
  canManageStaffTarget,
  type StaffRole,
} from "@/lib/loyalty";
import { withApiErrorHandling } from "@/lib/observability";
import { rejectCrossOrigin } from "@/lib/security";

function requestedStaffRole(value: unknown): StaffRole | null {
  return value === "OWNER" || value === "MANAGER" || value === "EMPLOYEE" || value === "VIEWER"
    ? value
    : null;
}

async function handlePatch(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = rejectCrossOrigin(req);
  if (originError) return originError;

  const session = await getSession();
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!canManageStaff(session.role)) return Response.json({ error: "FORBIDDEN" }, { status: 403 });

  const { id } = await params;
  if (id === session.staffId) return Response.json({ error: "CANNOT_MODIFY_SELF" }, { status: 409 });

  const body = await req.json().catch(() => ({}));
  const hasActive = Object.prototype.hasOwnProperty.call(body, "active");
  const hasRole = Object.prototype.hasOwnProperty.call(body, "role");
  if (!hasActive && !hasRole) return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
  if (hasActive && typeof body.active !== "boolean") return Response.json({ error: "INVALID_INPUT" }, { status: 400 });

  const requestedRole = hasRole ? requestedStaffRole(body.role) : null;
  if (hasRole && !requestedRole) return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
  if (requestedRole && !canAssignStaffRole(session.role, requestedRole)) {
    return Response.json({ error: "FORBIDDEN_ROLE" }, { status: 403 });
  }

  try {
    const employee = await sql.begin(async (tx) => {
      const [target] = await tx`
        select id,email,role,active,created_at from staff_users
        where id=${id} and establishment_id=${session.establishmentId}
        limit 1 for update
      `;
      if (!target) return null;

      const currentRole = String(target.role) as StaffRole;
      if (!canManageStaffTarget(session.role, currentRole)) throw new Error("PROTECTED_ROLE");

      const nextRole = requestedRole || currentRole;
      const nextActive = hasActive ? Boolean(body.active) : Boolean(target.active);
      const roleChanged = nextRole !== currentRole;
      const activeChanged = nextActive !== Boolean(target.active);

      if (!roleChanged && !activeChanged) return target;

      const [updated] = await tx`
        update staff_users
        set
          role=${nextRole},
          active=${nextActive},
          token_version=token_version+1,
          updated_at=now()
        where id=${id} and establishment_id=${session.establishmentId}
        returning id,email,role,active,created_at
      `;

      if (!nextActive || roleChanged) {
        await tx`
          update password_reset_tokens
          set used_at=now()
          where staff_user_id=${id} and used_at is null
        `;
      }

      await tx`
        insert into audit_logs(establishment_id,staff_user_id,action,entity_type,entity_id,metadata)
        values(
          ${session.establishmentId},
          ${session.staffId},
          'STAFF_UPDATE',
          'staff_user',
          ${id},
          ${tx.json({
            previousRole: currentRole,
            role: nextRole,
            previousActive: Boolean(target.active),
            active: nextActive,
            roleChanged,
            activeChanged,
          })}
        )
      `;
      return updated;
    });

    return employee
      ? Response.json(employee)
      : Response.json({ error: "NOT_FOUND" }, { status: 404 });
  } catch (error) {
    if (error instanceof Error && error.message === "PROTECTED_ROLE") {
      return Response.json({ error: "PROTECTED_ROLE" }, { status: 403 });
    }
    throw error;
  }
}

export const PATCH = withApiErrorHandling("EMPLOYEE_PATCH", handlePatch);
