import { getSession } from "@/lib/auth";
import { sendCampaignBatch } from "@/lib/campaign-store";
import { isMissingCampaignSchema } from "@/lib/campaigns";
import { EmailDeliveryError } from "@/lib/email";
import { canSendCampaigns } from "@/lib/loyalty";
import { withApiErrorHandling } from "@/lib/observability";
import { enforceRateLimit } from "@/lib/rate-limit";
import { PRIVATE_HEADERS, rejectCrossOrigin } from "@/lib/security";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Envoie le lot suivant d'une campagne ; à rappeler tant que `pending` > 0. */
async function handlePost(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = rejectCrossOrigin(req);
  if (originError) return originError;
  const session = await getSession();
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401, headers: PRIVATE_HEADERS });
  if (!canSendCampaigns(session.role)) return Response.json({ error: "FORBIDDEN" }, { status: 403, headers: PRIVATE_HEADERS });
  const limited = await enforceRateLimit(req, `campaigns-send:${session.staffId}`, 240, 60 * 60);
  if (limited) return limited;
  const { id } = await params;
  if (!UUID.test(id)) return Response.json({ error: "NOT_FOUND" }, { status: 404, headers: PRIVATE_HEADERS });
  try {
    const progress = await sendCampaignBatch(session.establishmentId, session.staffId, id);
    if (!progress) return Response.json({ error: "NOT_FOUND" }, { status: 404, headers: PRIVATE_HEADERS });
    return Response.json(progress, { headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof EmailDeliveryError && error.code === "EMAIL_NOT_CONFIGURED") {
      return Response.json({ error: "EMAIL_NOT_CONFIGURED" }, { status: 503, headers: PRIVATE_HEADERS });
    }
    if (isMissingCampaignSchema(error)) return Response.json({ error: "CAMPAIGNS_UNAVAILABLE" }, { status: 503, headers: PRIVATE_HEADERS });
    throw error;
  }
}

export const POST = withApiErrorHandling("CAMPAIGNS_SEND", handlePost);
