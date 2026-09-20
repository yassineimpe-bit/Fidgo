import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { canManageProgram } from "@/lib/loyalty";
import { withApiErrorHandling } from "@/lib/observability";
import { enforceRateLimit } from "@/lib/rate-limit";
import { rejectCrossOrigin } from "@/lib/security";

/**
 * Les URL fournies par le commercant finissent dans <img src> et <a href> sur
 * des pages publiques. Aucune validation serveur n'existait (seul `type="url"`
 * cote client), ce qui autorisait javascript:, data: et l'appel de domaines
 * arbitraires depuis la page carte des clients.
 */
function safeHttpsUrl(input: unknown, max = 500): string | null {
  if (!input) return null;
  const raw = String(input).trim();
  if (raw.length > max) return null;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString().length <= max ? url.toString() : null;
  } catch {
    return null;
  }
}

async function handleGet() {
  const session = await getSession();
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const [restaurant] = await sql`
    select id, slug, name, logo_url, primary_color, address, phone, instagram, website, status, created_at, updated_at
    from establishments where id = ${session.establishmentId}
  `;
  return Response.json(restaurant, { headers: { "cache-control": "no-store" } });
}

export const GET = withApiErrorHandling("RESTAURANT_GET", handleGet);

async function handlePatch(req: Request) {
  const originError = rejectCrossOrigin(req);
  if (originError) return originError;
  const session = await getSession();
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!canManageProgram(session.role)) return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  const limited = await enforceRateLimit(req, `restaurant-patch:${session.staffId}`, 30, 60 * 60);
  if (limited) return limited;
  const b: unknown = await req.json().catch(() => null);
  if (!b || typeof b !== "object" || Array.isArray(b)) return Response.json({ error: "INVALID_BODY" }, { status: 400 });
  const values = b as Record<string, unknown>;
  const limits: Record<string, number> = { name: 120, logoUrl: 500, primaryColor: 7, address: 240, phone: 40, instagram: 120, website: 500 };
  for (const [key, max] of Object.entries(limits)) {
    const value = values[key];
    if (value !== undefined && value !== null && (typeof value !== "string" || value.trim().length > max)) {
      return Response.json({ error: "INVALID_FIELD", field: key }, { status: 400 });
    }
  }
  const name = typeof values.name === "string" ? values.name.trim() : null;
  if (values.name !== undefined && !name) return Response.json({ error: "INVALID_FIELD", field: "name" }, { status: 400 });
  const color = typeof values.primaryColor === "string" ? values.primaryColor.trim() : null;
  if (values.primaryColor !== undefined && (!color || !/^#[0-9a-fA-F]{6}$/.test(color))) {
    return Response.json({ error: "INVALID_FIELD", field: "primaryColor" }, { status: 400 });
  }
  const logoUrl = safeHttpsUrl(values.logoUrl);
  const website = safeHttpsUrl(values.website);
  if (values.logoUrl && !logoUrl) return Response.json({ error: "INVALID_FIELD", field: "logoUrl" }, { status: 400 });
  if (values.website && !website) return Response.json({ error: "INVALID_FIELD", field: "website" }, { status: 400 });
  const address = typeof values.address === "string" ? values.address.trim() || null : null;
  const phone = typeof values.phone === "string" ? values.phone.trim() || null : null;
  const instagram = typeof values.instagram === "string" ? values.instagram.trim() || null : null;
  const restaurant = await sql.begin(async (tx) => {
    const [updated] = await tx`
      update establishments set
        name = case when ${values.name !== undefined} then ${name} else name end,
        logo_url = case when ${values.logoUrl !== undefined} then ${logoUrl} else logo_url end,
        primary_color = case when ${values.primaryColor !== undefined} then ${color} else primary_color end,
        address = case when ${values.address !== undefined} then ${address} else address end,
        phone = case when ${values.phone !== undefined} then ${phone} else phone end,
        instagram = case when ${values.instagram !== undefined} then ${instagram} else instagram end,
        website = case when ${values.website !== undefined} then ${website} else website end,
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
  return Response.json(restaurant, { headers: { "cache-control": "no-store" } });
}

export const PATCH = withApiErrorHandling("RESTAURANT_PATCH", handlePatch);
