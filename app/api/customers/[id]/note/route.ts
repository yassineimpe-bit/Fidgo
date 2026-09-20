import { getSession } from "@/lib/auth";
import { parseCustomerNote } from "@/lib/customer-note";
import { sql } from "@/lib/db";
import { canManageProgram } from "@/lib/loyalty";
import { withApiErrorHandling } from "@/lib/observability";
import { enforceRateLimit } from "@/lib/rate-limit";
import { PRIVATE_HEADERS, rejectCrossOrigin } from "@/lib/security";

async function handlePatch(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = rejectCrossOrigin(req);
  if (originError) return originError;
  const session = await getSession();
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401, headers: PRIVATE_HEADERS });
  if (!canManageProgram(session.role)) return Response.json({ error: "FORBIDDEN" }, { status: 403, headers: PRIVATE_HEADERS });
  const limited = await enforceRateLimit(req, `customer-note:${session.staffId}`, 60, 60 * 60);
  if (limited) return limited;

  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return Response.json({ error: "NOT_FOUND" }, { status: 404, headers: PRIVATE_HEADERS });
  }
  const body = await req.json().catch(() => null);
  const parsed = parseCustomerNote(body?.note);
  if (!parsed.ok) return Response.json({ error: "INVALID_NOTE" }, { status: 400, headers: PRIVATE_HEADERS });

  const result = await sql.begin(async (tx) => {
    const [customer] = await tx`
      select internal_note from customers
      where id=${id} and establishment_id=${session.establishmentId} and deleted_at is null
      for update
    `;
    if (!customer) return null;
    if (customer.internal_note === parsed.note) return { changed: false };
    await tx`
      update customers set internal_note=${parsed.note}, updated_at=now()
      where id=${id} and establishment_id=${session.establishmentId} and deleted_at is null
    `;
    // Ne jamais copier le texte libre dans les journaux.
    await tx`
      insert into audit_logs(establishment_id,staff_user_id,action,entity_type,entity_id,metadata)
      values(${session.establishmentId},${session.staffId},'CUSTOMER_NOTE_UPDATED','customer',${id},
        ${tx.json({ cleared: parsed.note === null })})
    `;
    return { changed: true };
  });
  if (!result) return Response.json({ error: "NOT_FOUND" }, { status: 404, headers: PRIVATE_HEADERS });
  return Response.json({ ok: true, ...result }, { headers: PRIVATE_HEADERS });
}

export const PATCH = withApiErrorHandling("CUSTOMER_NOTE_UPDATE", handlePatch);
