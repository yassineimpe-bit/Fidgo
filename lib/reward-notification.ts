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

type RewardDelivery = {
  notificationId: string;
  customerId: string;
  email: string;
  restaurantName: string;
  restaurantAddress: string | null;
  rewardLabel: string;
};

/**
 * Réserve l'envoi sous le verrou de la carte. Le verrou est le même que celui
 * du ledger : deux franchissements concurrents d'une même carte ne peuvent
 * donc pas observer simultanément une fenêtre de 24 h vide.
 */
async function reserveRewardDelivery(establishmentId: string, transactionId: string): Promise<RewardDelivery | null> {
  return sql.begin(async (tx) => {
    const [row] = await tx`
      select t.card_id, c.customer_id, u.email, e.name, e.address, p.reward_label,
        to_jsonb(p)->>'reward_email_enabled' as enabled
      from transactions t
      join cards c on c.id=t.card_id and c.establishment_id=t.establishment_id
      join customers u on u.id=c.customer_id and u.establishment_id=t.establishment_id
      join establishments e on e.id=t.establishment_id
      join loyalty_programs p on p.establishment_id=t.establishment_id
      where t.id=${transactionId} and t.establishment_id=${establishmentId} and t.type='earn'
        and c.active=true and (c.expires_at is null or c.expires_at > now())
        and e.status='active' and p.active=true and u.deleted_at is null
        and u.marketing_consent=true and u.email is not null
      for update of c
    `;
    if (!row || row.enabled !== "true") return null;

    const [existing] = await tx`
      select id, status from reward_notifications
      where transaction_id=${transactionId} and establishment_id=${establishmentId} and card_id=${row.card_id}
      for update
    `;

    let notificationId: string | null = null;
    if (existing) {
      // Un échec explicite peut être rejoué avec la même clé prestataire. Une
      // réservation pending/sent reste strictement idempotente.
      if (existing.status !== "failed") return null;
      const [retried] = await tx`
        update reward_notifications n set status='pending', error=null, sent_at=null, created_at=now()
        where n.id=${existing.id} and n.status='failed'
          and not exists (
            select 1 from reward_notifications recent
            where recent.card_id=${row.card_id} and recent.id<>n.id
              and recent.created_at > now() - make_interval(hours => ${CARD_NOTIFICATION_GAP_HOURS})
          )
        returning n.id
      `;
      notificationId = retried ? String(retried.id) : null;
    } else {
      const [claimed] = await tx`
        insert into reward_notifications (establishment_id, card_id, transaction_id)
        select ${establishmentId}, ${row.card_id}, ${transactionId}
        where not exists (
          select 1 from reward_notifications
          where card_id=${row.card_id} and created_at > now() - make_interval(hours => ${CARD_NOTIFICATION_GAP_HOURS})
        )
        on conflict (transaction_id) do nothing
        returning id
      `;
      notificationId = claimed ? String(claimed.id) : null;
    }

    if (!notificationId) return null;
    return {
      notificationId,
      customerId: String(row.customer_id),
      email: String(row.email),
      restaurantName: String(row.name),
      restaurantAddress: row.address ? String(row.address) : null,
      rewardLabel: String(row.reward_label),
    };
  });
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
    const delivery = await reserveRewardDelivery(establishmentId, transactionId);
    if (!delivery) return;

    const appUrl = getAppUrl();
    const token = unsubscribeToken(delivery.customerId);
    const restaurant = delivery.restaurantName;
    try {
      await sendCampaignEmail({
        to: delivery.email,
        restaurantName: restaurant,
        restaurantAddress: delivery.restaurantAddress,
        subject: `Votre récompense vous attend chez ${restaurant}`,
        message: [
          "Bonjour,",
          `Votre carte de fidélité ${restaurant} est complète : « ${delivery.rewardLabel} » vous attend.`,
          "Présentez votre carte lors de votre prochaine visite pour en profiter.",
        ].join("\n\n"),
        unsubscribeUrl: `${appUrl}/unsubscribe/${token}`,
        oneClickUnsubscribeUrl: `${appUrl}/api/unsubscribe/${token}`,
        idempotencyKey: `reward-${transactionId}`,
      });
      await sql`update reward_notifications set status='sent', sent_at=now(), error=null where id=${delivery.notificationId} and status='pending'`;
    } catch (error) {
      const code = error instanceof EmailDeliveryError ? error.code : "EMAIL_SEND_FAILED";
      await sql`update reward_notifications set status='failed', error=${code.slice(0, 60)} where id=${delivery.notificationId} and status='pending'`;
    }
  } catch (error) {
    if (isMissingSchema(error)) return;
    console.error("REWARD_NOTIFICATION_FAILED", { code: safeErrorCode(error, "REWARD_NOTIFICATION_FAILED") });
  }
}
