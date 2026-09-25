import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { canManageEstablishment } from "@/lib/loyalty";
import { LOGO_MAX_BYTES, logoPath, uploadedLogoId } from "@/lib/logo";
import { parseLogoCrop, processLogo } from "@/lib/logo-image";
import { withApiErrorHandling } from "@/lib/observability";
import { enforceRateLimit } from "@/lib/rate-limit";
import { rejectCrossOrigin } from "@/lib/security";

const PRIVATE_HEADERS = { "cache-control": "no-store" };
const ERROR_STATUS = { FILE_TOO_LARGE: 413, UNSUPPORTED_FORMAT: 415, IMAGE_TOO_SMALL: 400, IMAGE_TOO_LARGE: 400, INVALID_CROP: 400, INVALID_IMAGE: 400 } as const;

function isMissingTable(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && String((error as { code?: unknown }).code) === "42P01";
}

async function authorize(req: Request) {
  const originError = rejectCrossOrigin(req);
  if (originError) return { response: originError };
  const session = await getSession();
  if (!session) return { response: Response.json({ error: "UNAUTHORIZED" }, { status: 401, headers: PRIVATE_HEADERS }) };
  if (!canManageEstablishment(session.role)) return { response: Response.json({ error: "FORBIDDEN" }, { status: 403, headers: PRIVATE_HEADERS }) };
  const limited = await enforceRateLimit(req, `restaurant-logo:${session.staffId}`, 20, 60 * 60);
  if (limited) return { response: limited };
  return { session };
}

async function handlePost(req: Request) {
  const auth = await authorize(req);
  if (auth.response) return auth.response;
  const { session } = auth;

  // Refus avant lecture du corps quand la taille annoncée dépasse déjà la limite.
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > LOGO_MAX_BYTES + 64 * 1024) return Response.json({ error: "FILE_TOO_LARGE" }, { status: 413, headers: PRIVATE_HEADERS });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !(file instanceof File)) return Response.json({ error: "INVALID_BODY" }, { status: 400, headers: PRIVATE_HEADERS });
  if (file.size > LOGO_MAX_BYTES) return Response.json({ error: "FILE_TOO_LARGE" }, { status: 413, headers: PRIVATE_HEADERS });
  const crop = parseLogoCrop({ x: form.get("cropX"), y: form.get("cropY"), size: form.get("cropSize") });
  if (crop === "invalid") return Response.json({ error: "INVALID_CROP" }, { status: 400, headers: PRIVATE_HEADERS });

  const processed = await processLogo(Buffer.from(await file.arrayBuffer()), crop);
  if (!processed.ok) return Response.json({ error: processed.error }, { status: ERROR_STATUS[processed.error], headers: PRIVATE_HEADERS });
  const { logo } = processed;

  try {
    const logoUrl = await sql.begin(async (tx) => {
      await tx`select id from establishments where id=${session.establishmentId} for update`;
      const [stored] = await tx`
        insert into establishment_logos (establishment_id, content, content_type, width, height, byte_size, sha256)
        values (${session.establishmentId}, ${logo.content}, 'image/webp', ${logo.width}, ${logo.height}, ${logo.content.length}, ${logo.sha256})
        returning id
      `;
      const url = logoPath(String(stored.id));
      await tx`update establishments set logo_url=${url}, updated_at=now() where id=${session.establishmentId}`;
      // Remplacement : l'ancien fichier disparaît dans la même transaction.
      await tx`delete from establishment_logos where establishment_id=${session.establishmentId} and id<>${stored.id}`;
      await tx`
        insert into audit_logs (establishment_id, staff_user_id, action, entity_type, entity_id, metadata)
        values (${session.establishmentId}, ${session.staffId}, 'RESTAURANT_LOGO_UPLOADED', 'establishment', ${session.establishmentId},
          ${sql.json({ byteSize: logo.content.length, width: logo.width, height: logo.height, cropped: crop !== null })})
      `;
      return url;
    });
    return Response.json({ logoUrl }, { status: 201, headers: PRIVATE_HEADERS });
  } catch (error) {
    if (isMissingTable(error)) return Response.json({ error: "LOGO_STORAGE_UNAVAILABLE" }, { status: 503, headers: PRIVATE_HEADERS });
    throw error;
  }
}

async function handleDelete(req: Request) {
  const auth = await authorize(req);
  if (auth.response) return auth.response;
  const { session } = auth;
  try {
    await sql.begin(async (tx) => {
      const [current] = await tx`select logo_url from establishments where id=${session.establishmentId} for update`;
      if (uploadedLogoId(current?.logo_url)) {
        await tx`update establishments set logo_url=null, updated_at=now() where id=${session.establishmentId}`;
      }
      const removed = await tx`delete from establishment_logos where establishment_id=${session.establishmentId} returning id`;
      if (removed.length) {
        await tx`
          insert into audit_logs (establishment_id, staff_user_id, action, entity_type, entity_id)
          values (${session.establishmentId}, ${session.staffId}, 'RESTAURANT_LOGO_REMOVED', 'establishment', ${session.establishmentId})
        `;
      }
    });
    return Response.json({ ok: true }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    if (isMissingTable(error)) return Response.json({ error: "LOGO_STORAGE_UNAVAILABLE" }, { status: 503, headers: PRIVATE_HEADERS });
    throw error;
  }
}

export const POST = withApiErrorHandling("RESTAURANT_LOGO_UPLOAD", handlePost);
export const DELETE = withApiErrorHandling("RESTAURANT_LOGO_DELETE", handleDelete);
