import { getSession } from "@/lib/auth";
import { createCampaign, recentCampaignDates } from "@/lib/campaign-store";
import { isMissingCampaignSchema, nextCampaignAllowedAt, parseCampaignInput } from "@/lib/campaigns";
import { sql } from "@/lib/db";
import { campaignEmailTestMode, emailDeliveryConfigured } from "@/lib/email";
import { canAccessBackoffice, canSendCampaigns } from "@/lib/loyalty";
import { withApiErrorHandling } from "@/lib/observability";
import { enforceRateLimit } from "@/lib/rate-limit";
import { PRIVATE_HEADERS, rejectCrossOrigin } from "@/lib/security";

const UNAVAILABLE = { error: "CAMPAIGNS_UNAVAILABLE" };

/** Historique des campagnes e-mail du commerce et limite en cours. */
async function handleGet(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401, headers: PRIVATE_HEADERS });
  if (!canAccessBackoffice(session.role)) return Response.json({ error: "FORBIDDEN" }, { status: 403, headers: PRIVATE_HEADERS });
  const limited = await enforceRateLimit(req, `campaigns-read:${session.staffId}`, 120, 60);
  if (limited) return limited;
  try {
    const campaigns = await sql`
      select id, kind, segment, inactive_days, title, status, recipient_count, sent_count, failed_count, skipped_count, created_at, completed_at
      from campaigns where establishment_id=${session.establishmentId} and channel='email'
      order by created_at desc limit 50
    `;
    const nextAllowedAt = nextCampaignAllowedAt(await recentCampaignDates(sql, session.establishmentId));
    return Response.json({ campaigns, nextAllowedAt }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    if (isMissingCampaignSchema(error)) return Response.json(UNAVAILABLE, { status: 503, headers: PRIVATE_HEADERS });
    throw error;
  }
}

/** Crée une campagne et fige ses destinataires ; l'envoi se fait ensuite par lots. */
async function handlePost(req: Request) {
  const originError = rejectCrossOrigin(req);
  if (originError) return originError;
  const session = await getSession();
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401, headers: PRIVATE_HEADERS });
  if (!canSendCampaigns(session.role)) return Response.json({ error: "FORBIDDEN" }, { status: 403, headers: PRIVATE_HEADERS });
  const limited = await enforceRateLimit(req, `campaigns-create:${session.staffId}`, 10, 60 * 60);
  if (limited) return limited;
  const parsed = parseCampaignInput(await req.json().catch(() => null));
  if (!parsed.ok) return Response.json({ error: parsed.error, field: parsed.field }, { status: 400, headers: PRIVATE_HEADERS });
  if (!emailDeliveryConfigured() && !campaignEmailTestMode()) {
    return Response.json({ error: "EMAIL_NOT_CONFIGURED" }, { status: 503, headers: PRIVATE_HEADERS });
  }
  try {
    const result = await createCampaign(session.establishmentId, session.staffId, parsed.value);
    if (!result.ok) {
      if (result.error === "NO_RECIPIENTS") return Response.json({ error: "NO_RECIPIENTS" }, { status: 409, headers: PRIVATE_HEADERS });
      return Response.json({ error: "CAMPAIGN_LIMIT", retryAt: result.retryAt }, { status: 429, headers: PRIVATE_HEADERS });
    }
    return Response.json({ id: result.id, recipientCount: result.recipientCount }, { status: result.replayed ? 200 : 201, headers: PRIVATE_HEADERS });
  } catch (error) {
    if (isMissingCampaignSchema(error)) return Response.json(UNAVAILABLE, { status: 503, headers: PRIVATE_HEADERS });
    throw error;
  }
}

export const GET = withApiErrorHandling("CAMPAIGNS_LIST", handleGet);
export const POST = withApiErrorHandling("CAMPAIGNS_CREATE", handlePost);
