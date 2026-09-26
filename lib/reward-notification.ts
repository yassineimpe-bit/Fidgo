import { getAppUrl } from "@/lib/app-url";
import { sql } from "@/lib/db";
import { EmailDeliveryError, campaignEmailTestMode, emailDeliveryConfigured, sendCampaignEmail } from "@/lib/email";
import { safeErrorCode } from "@/lib/observability";
import { unsubscribeToken } from "@/lib/unsubscribe";

/** Une seule notification par carte sur cette durée, même si le seuil est franchi à nouveau. */
const CARD_NOTIFICATION_GAP_HOURS = 24;

function isMissingSchema(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "";
  return code === "42P01" || code === "42703";
}

export function crossedRewardThreshold(previousBalance: number, balance: number, threshold: number) {
  return threshold > 0 && previousBalance < threshold && balance >= threshold;
}

/**
 * Prévient le client que sa récompense est disponible, après la réponse au
 * scanner (jamais sur le chemin critique). Uniquement si le commerce a activé
 * l'option et si le client a lui-même accepté les offres, avec une adresse
 * e-mail. Aucune erreur ne remonte : l'envoi est un bonus, pas une condition.
 */
export async function notifyRewardAvailable(establishmentId: string, transactionId: string): Promise<void> {
  try {
    if (!emailDeliveryConfigured() && !campaignEmailTestMode()) return;
    const [row] = await sql`
      select t.card_id, c.customer_id, u.email, e.name, e.address, p.reward_label,
        to_jsonb(p)->>'reward_email_enabled' as enabled
      from transactions t
      join cards c on c.id=t.card_id and c.establishment_id=t.establishment_id
      join customers u on u.id=c.customer_id
      join establishments e on e.id=t.establishment_id
      join loyalty_programs p on p.establishment_id=t.establishment_id
      where t.id=${transactionId} and t.establishment_id=${establishmentId} and t.type='earn'
        and c.active=true and e.status='active' and u.deleted_at is null
        and u.marketing_consent=true and u.email is not null
    `;
    if (!row || row.enabled !== "true") return;

    const [claimed] = await sql`
      insert into reward_notifications (establishment_id, card_id, transaction_id)
      select ${establishmentId}, ${row.card_id}, ${transactionId}
      where not exists (
        select 1 from reward_notifications
        where card_id=${row.card_id} and created_at > now() - make_interval(hours => ${CARD_NOTIFICATION_GAP_HOURS})
      )
      on conflict (transaction_id) do nothing
      returning id
    `;
    if (!claimed) return;

    const appUrl = getAppUrl();
    const token = unsubscribeToken(String(row.customer_id));
    const restaurant = String(row.name);
    try {
      await sendCampaignEmail({
        to: String(row.email),
        restaurantName: restaurant,
        restaurantAddress: row.address ? String(row.address) : null,
        subject: `Votre récompense vous attend chez ${restaurant}`,
        message: [
          "Bonjour,",
          `Votre carte de fidélité ${restaurant} est complète : « ${String(row.reward_label)} » vous attend.`,
          "Présentez votre carte lors de votre prochaine visite pour en profiter.",
        ].join("\n\n"),
        unsubscribeUrl: `${appUrl}/unsubscribe/${token}`,
        oneClickUnsubscribeUrl: `${appUrl}/api/unsubscribe/${token}`,
        idempotencyKey: `reward-${transactionId}`,
      });
      await sql`update reward_notifications set status='sent', sent_at=now() where id=${claimed.id}`;
    } catch (error) {
      const code = error instanceof EmailDeliveryError ? error.code : "EMAIL_SEND_FAILED";
      await sql`update reward_notifications set status='failed', error=${code.slice(0, 60)} where id=${claimed.id}`;
    }
  } catch (error) {
    if (isMissingSchema(error)) return;
    console.error("REWARD_NOTIFICATION_FAILED", { code: safeErrorCode(error, "REWARD_NOTIFICATION_FAILED") });
  }
}
