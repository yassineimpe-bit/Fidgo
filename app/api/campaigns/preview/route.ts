import { getSession } from "@/lib/auth";
import { countEligible } from "@/lib/campaign-store";
import { CAMPAIGN_MAX_RECIPIENTS, isMissingCampaignSchema, parseAudience } from "@/lib/campaigns";
import { canSendCampaigns } from "@/lib/loyalty";
import { withApiErrorHandling } from "@/lib/observability";
import { enforceRateLimit } from "@/lib/rate-limit";
import { PRIVATE_HEADERS, rejectCrossOrigin } from "@/lib/security";

/** Nombre de clients qui recevraient la campagne (aucun e-mail n'est révélé). */
async function handlePost(req: Request) {
  const originError = rejectCrossOrigin(req);
  if (originError) return originError;
  const session = await getSession();
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401, headers: PRIVATE_HEADERS });
  if (!canSendCampaigns(session.role)) return Response.json({ error: "FORBIDDEN" }, { status: 403, headers: PRIVATE_HEADERS });
  const limited = await enforceRateLimit(req, `campaigns-preview:${session.staffId}`, 60, 60);
  if (limited) return limited;
  const parsed = parseAudience(await req.json().catch(() => null));
  if (!parsed.ok) return Response.json({ error: parsed.error, field: parsed.field }, { status: 400, headers: PRIVATE_HEADERS });
  try {
    const eligible = await countEligible(session.establishmentId, parsed.value);
    return Response.json({ eligible, recipients: Math.min(eligible, CAMPAIGN_MAX_RECIPIENTS) }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    if (isMissingCampaignSchema(error)) return Response.json({ error: "CAMPAIGNS_UNAVAILABLE" }, { status: 503, headers: PRIVATE_HEADERS });
    throw error;
  }
}

export const POST = withApiErrorHandling("CAMPAIGNS_PREVIEW", handlePost);
