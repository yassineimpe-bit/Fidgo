import { getSession } from "@/lib/auth";
import { CARD_IMAGE_MAX_BYTES, cardImagePath, processCardImage } from "@/lib/card-image";
import { sql } from "@/lib/db";
import { canManageEstablishment } from "@/lib/loyalty";
import { withApiErrorHandling } from "@/lib/observability";
import { enforceRateLimit } from "@/lib/rate-limit";
import { rejectCrossOrigin } from "@/lib/security";

const PRIVATE_HEADERS = { "cache-control": "no-store" };
const ERROR_STATUS = { FILE_TOO_LARGE: 413, UNSUPPORTED_FORMAT: 415, IMAGE_TOO_SMALL: 400, IMAGE_TOO_LARGE: 400, INVALID_IMAGE: 400 } as const;

function isMissingSchema(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "";
  return code === "42P01" || code === "42703";
}

async function authorize(req: Request) {
  const originError = rejectCrossOrigin(req);
  if (originError) return { response: originError };
  const session = await getSession();
  if (!session) return { response: Response.json({ error: "UNAUTHORIZED" }, { status: 401, headers: PRIVATE_HEADERS }) };
  if (!canManageEstablishment(session.role)) return { response: Response.json({ error: "FORBIDDEN" }, { status: 403, headers: PRIVATE_HEADERS }) };
  const limited = await enforceRateLimit(req, `restaurant-card-image:${session.staffId}`, 20, 60 * 60);
  if (limited) return { response: limited };
  return { session };
}

/** Importe le visuel de la carte ; remplace le précédent dans la même transaction. */
async function handlePost(req: Request) {
  const auth = await authorize(req);
  if (auth.response) return auth.response;
  const { session } = auth;

  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > CARD_IMAGE_MAX_BYTES + 64 * 1024) return Response.json({ error: "FILE_TOO_LARGE" }, { status: 413, headers: PRIVATE_HEADERS });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !(file instanceof File)) return Response.json({ error: "INVALID_BODY" }, { status: 400, headers: PRIVATE_HEADERS });
  if (file.size > CARD_IMAGE_MAX_BYTES) return Response.json({ error: "FILE_TOO_LARGE" }, { status: 413, headers: PRIVATE_HEADERS });

  const processed = await processCardImage(Buffer.from(await file.arrayBuffer()));
  if (!processed.ok) return Response.json({ error: processed.error }, { status: ERROR_STATUS[processed.error], headers: PRIVATE_HEADERS });
  const { image } = processed;

  try {
    const cardImageUrl = await sql.begin(async (tx) => {
      await tx`select id from establishments where id=${session.establishmentId} for update`;
      const [stored] = await tx`
        insert into establishment_card_images (establishment_id, content, content_type, width, height, byte_size, sha256)
        values (${session.establishmentId}, ${image.content}, 'image/webp', ${image.width}, ${image.height}, ${image.content.length}, ${image.sha256})
        returning id
      `;
      await tx`update establishments set card_image_id=${stored.id}, updated_at=now() where id=${session.establishmentId}`;
      await tx`delete from establishment_card_images where establishment_id=${session.establishmentId} and id<>${stored.id}`;
      await tx`
        insert into audit_logs (establishment_id, staff_user_id, action, entity_type, entity_id, metadata)
        values (${session.establishmentId}, ${session.staffId}, 'RESTAURANT_CARD_IMAGE_UPLOADED', 'establishment', ${session.establishmentId},
          ${tx.json({ byteSize: image.content.length, width: image.width, height: image.height })})
      `;
      return cardImagePath(String(stored.id));
    });
    return Response.json({ cardImageUrl }, { status: 201, headers: PRIVATE_HEADERS });
  } catch (error) {
    if (isMissingSchema(error)) return Response.json({ error: "CARD_IMAGE_UNAVAILABLE" }, { status: 503, headers: PRIVATE_HEADERS });
    throw error;
  }
}

/** Retire le visuel ; un fond « image » repasse en couleur unie. */
async function handleDelete(req: Request) {
  const auth = await authorize(req);
  if (auth.response) return auth.response;
  const { session } = auth;
  try {
    await sql.begin(async (tx) => {
      await tx`
        update establishments set card_image_id=null,
          card_background=case when card_background='image' then 'solid' else card_background end, updated_at=now()
        where id=${session.establishmentId}
      `;
      const removed = await tx`delete from establishment_card_images where establishment_id=${session.establishmentId} returning id`;
      if (removed.length) {
        await tx`
          insert into audit_logs (establishment_id, staff_user_id, action, entity_type, entity_id)
          values (${session.establishmentId}, ${session.staffId}, 'RESTAURANT_CARD_IMAGE_REMOVED', 'establishment', ${session.establishmentId})
        `;
      }
    });
    return Response.json({ ok: true }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    if (isMissingSchema(error)) return Response.json({ error: "CARD_IMAGE_UNAVAILABLE" }, { status: 503, headers: PRIVATE_HEADERS });
    throw error;
  }
}

export const POST = withApiErrorHandling("RESTAURANT_CARD_IMAGE_UPLOAD", handlePost);
export const DELETE = withApiErrorHandling("RESTAURANT_CARD_IMAGE_DELETE", handleDelete);
