import { cardImageId, cardImagePath } from "@/lib/card-image";
import { sql } from "@/lib/db";
import { withApiErrorHandling } from "@/lib/observability";

/**
 * Visuel public d'un commerce actif. Nouvel identifiant à chaque import :
 * réponse immuable. Toujours un WebP ré-encodé par le serveur.
 */
async function handleGet(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = cardImageId(cardImagePath(String(raw).toLowerCase()));
  const notFound = () => new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
  if (!id) return notFound();
  let image;
  try {
    [image] = await sql`
      select i.content, i.content_type, i.sha256
      from establishment_card_images i join establishments e on e.id=i.establishment_id
      where i.id=${id} and e.status='active'
    `;
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && String((error as { code?: unknown }).code) === "42P01") return notFound();
    throw error;
  }
  if (!image) return notFound();
  return new Response(new Uint8Array(image.content as Buffer), {
    headers: {
      "content-type": String(image.content_type),
      "cache-control": "public, max-age=31536000, immutable",
      etag: `"${image.sha256}"`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "cross-origin-resource-policy": "same-site",
    },
  });
}

export const GET = withApiErrorHandling("CARD_IMAGE_GET", handleGet);
