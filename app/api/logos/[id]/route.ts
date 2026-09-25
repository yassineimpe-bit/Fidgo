import { sql } from "@/lib/db";
import { logoPath, uploadedLogoId } from "@/lib/logo";
import { withApiErrorHandling } from "@/lib/observability";

/**
 * Logo public d'un commerce actif. L'identifiant change à chaque import :
 * la réponse est immuable et peut être mise en cache longtemps. Le contenu est
 * toujours un WebP ré-encodé par le serveur, jamais le fichier d'origine.
 */
async function handleGet(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = uploadedLogoId(logoPath(String(raw).toLowerCase()));
  const notFound = () => new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
  if (!id) return notFound();
  let logo;
  try {
    [logo] = await sql`
      select l.content, l.content_type, l.sha256
      from establishment_logos l join establishments e on e.id=l.establishment_id
      where l.id=${id} and e.status='active'
    `;
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && String((error as { code?: unknown }).code) === "42P01") return notFound();
    throw error;
  }
  if (!logo) return notFound();
  return new Response(new Uint8Array(logo.content as Buffer), {
    headers: {
      "content-type": String(logo.content_type),
      "cache-control": "public, max-age=31536000, immutable",
      etag: `"${logo.sha256}"`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "cross-origin-resource-policy": "same-site",
    },
  });
}

export const GET = withApiErrorHandling("LOGO_GET", handleGet);
