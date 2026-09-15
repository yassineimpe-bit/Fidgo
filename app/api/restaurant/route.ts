import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { canManageProgram } from "@/lib/loyalty";
import { rejectCrossOrigin } from "@/lib/security";

export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const [restaurant] = await sql`select * from establishments where id = ${session.establishmentId}`;
  return Response.json(restaurant);
}

export async function PATCH(req: Request) {
  const originError = rejectCrossOrigin(req);
  if (originError) return originError;
  const session = await getSession();
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!canManageProgram(session.role)) return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  const b = await req.json();
  const color = /^#[0-9a-fA-F]{6}$/.test(String(b.primaryColor || "")) ? String(b.primaryColor) : "#111111";
  const restaurant = await sql.begin(async (tx) => {
    const [updated] = await tx`
      update establishments set
        name = ${String(b.name || "Commerce").slice(0, 120)},
        logo_url = ${b.logoUrl ? String(b.logoUrl).slice(0, 500) : null},
        primary_color = ${color},
        address = ${b.address ? String(b.address).slice(0, 240) : null},
        phone = ${b.phone ? String(b.phone).slice(0, 40) : null},
        instagram = ${b.instagram ? String(b.instagram).slice(0, 120) : null},
        website = ${b.website ? String(b.website).slice(0, 500) : null},
        updated_at = now()
      where id = ${session.establishmentId}
      returning *
    `;
    await tx`
      insert into audit_logs (establishment_id, staff_user_id, action, entity_type, entity_id)
      values (${session.establishmentId}, ${session.staffId}, 'RESTAURANT_UPDATE', 'establishment', ${session.establishmentId})
    `;
    return updated;
  });
  return Response.json(restaurant);
}
