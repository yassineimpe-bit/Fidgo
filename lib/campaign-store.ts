import type { Sql, TransactionSql } from "postgres";
import { getAppUrl } from "@/lib/app-url";
import {
  ACTIVE_WINDOW_DAYS, CAMPAIGN_BATCH_SIZE, CAMPAIGN_CLAIM_LEASE_SECONDS, CAMPAIGN_MAX_RECIPIENTS,
  CUSTOMER_COOLDOWN_DAYS, nextCampaignAllowedAt, type CampaignAudience, type CampaignInput,
} from "@/lib/campaigns";
import { sql } from "@/lib/db";
import { EmailDeliveryError, sendCampaignEmail } from "@/lib/email";
import { unsubscribeToken } from "@/lib/unsubscribe";

type Db = Sql | TransactionSql;

/**
 * Clients joignables : consentement donné par le client, adresse e-mail,
 * carte active, et aucun e-mail promotionnel reçu depuis 7 jours.
 */
function eligibleCustomers(db: Db, establishmentId: string, audience: CampaignAudience) {
  const segment = audience.segment === "active"
    ? db`and exists (select 1 from transactions t where t.card_id=c.id and t.type='earn' and t.created_at > now() - make_interval(days => ${ACTIVE_WINDOW_DAYS}))`
    : audience.segment === "inactive"
      ? db`and c.created_at <= now() - make_interval(days => ${audience.inactiveDays})
           and not exists (select 1 from transactions t where t.card_id=c.id and t.type='earn' and t.created_at > now() - make_interval(days => ${audience.inactiveDays}))`
      : audience.segment === "reward_available"
        ? db`and c.balance >= p.reward_threshold`
        : db``;
  return db`
    select u.id
    from customers u
    join cards c on c.customer_id=u.id and c.establishment_id=u.establishment_id
    join loyalty_programs p on p.establishment_id=u.establishment_id
    where u.establishment_id=${establishmentId}
      and u.deleted_at is null and u.marketing_consent=true and u.email is not null
      and c.active=true and (c.expires_at is null or c.expires_at > now())
      and not exists (
        select 1 from campaign_recipients r
        where r.customer_id=u.id and r.status='sent' and r.sent_at > now() - make_interval(days => ${CUSTOMER_COOLDOWN_DAYS})
      )
      ${segment}
  `;
}

export async function countEligible(establishmentId: string, audience: CampaignAudience): Promise<number> {
  const [row] = await sql`select count(*)::int as total from (${eligibleCustomers(sql, establishmentId, audience)}) eligible`;
  return Number(row.total);
}

export async function recentCampaignDates(db: Db, establishmentId: string): Promise<Date[]> {
  const rows = await db`
    select created_at from campaigns
    where establishment_id=${establishmentId} and channel='email' and created_at > now() - interval '7 days'
  `;
  return rows.map((row) => new Date(row.created_at));
}

export type CreateCampaignResult =
  | { ok: true; id: string; recipientCount: number; replayed: boolean }
  | { ok: false; error: "RATE_LIMITED_CAMPAIGN"; retryAt: Date }
  | { ok: false; error: "NO_RECIPIENTS" };

/**
 * Crée la campagne et fige sa liste de destinataires dans une transaction.
 * Le verrou sur le commerce sérialise les créations concurrentes : la limite
 * hebdomadaire ne peut pas être dépassée par deux requêtes simultanées.
 */
export async function createCampaign(establishmentId: string, staffId: string, input: CampaignInput): Promise<CreateCampaignResult> {
  return sql.begin(async (tx) => {
    await tx`select id from establishments where id=${establishmentId} for update`;
    const [existing] = await tx`
      select id, recipient_count from campaigns where establishment_id=${establishmentId} and idempotency_key=${input.idempotencyKey}
    `;
    if (existing) return { ok: true as const, id: String(existing.id), recipientCount: Number(existing.recipient_count), replayed: true };

    const retryAt = nextCampaignAllowedAt(await recentCampaignDates(tx, establishmentId));
    if (retryAt) return { ok: false as const, error: "RATE_LIMITED_CAMPAIGN" as const, retryAt };

    const [campaign] = await tx`
      insert into campaigns (establishment_id, title, body, channel, status, kind, segment, inactive_days, created_by, idempotency_key)
      values (${establishmentId}, ${input.subject}, ${input.message}, 'email', 'sending', ${input.kind}, ${input.segment}, ${input.inactiveDays}, ${staffId}, ${input.idempotencyKey})
      returning id
    `;
    const inserted = await tx`
      insert into campaign_recipients (campaign_id, customer_id, status)
      select ${campaign.id}, eligible.id, 'pending'
      from (${eligibleCustomers(tx, establishmentId, input)} order by u.created_at, u.id limit ${CAMPAIGN_MAX_RECIPIENTS}) eligible
      returning id
    `;
    if (!inserted.length) {
      // Rien à envoyer : aucune campagne n'est conservée ni décomptée.
      await tx`delete from campaigns where id=${campaign.id}`;
      return { ok: false as const, error: "NO_RECIPIENTS" as const };
    }
    await tx`update campaigns set recipient_count=${inserted.length} where id=${campaign.id}`;
    await tx`
      insert into audit_logs (establishment_id, staff_user_id, action, entity_type, entity_id, metadata)
      values (${establishmentId}, ${staffId}, 'CAMPAIGN_CREATED', 'campaign', ${campaign.id},
        ${tx.json({ kind: input.kind, segment: input.segment, inactiveDays: input.inactiveDays, recipientCount: inserted.length })})
    `;
    return { ok: true as const, id: String(campaign.id), recipientCount: inserted.length, replayed: false };
  });
}

export type CampaignProgress = { status: string; recipientCount: number; sentCount: number; failedCount: number; skippedCount: number; pending: number };

async function progress(campaignId: string): Promise<CampaignProgress> {
  const [row] = await sql`
    select status, recipient_count, sent_count, failed_count, skipped_count,
      (select count(*)::int from campaign_recipients where campaign_id=${campaignId} and status='pending') as pending
    from campaigns where id=${campaignId}
  `;
  return {
    status: String(row.status), recipientCount: Number(row.recipient_count), sentCount: Number(row.sent_count),
    failedCount: Number(row.failed_count), skippedCount: Number(row.skipped_count), pending: Number(row.pending),
  };
}

/**
 * Envoie le lot suivant. Chaque destinataire est réservé (bail de 2 min) avant
 * l'appel au prestataire ; la clé d'idempotence par destinataire empêche un
 * second envoi si un lot interrompu est repris. Le consentement est relu au
 * moment de l'envoi : un client désabonné entre-temps est ignoré.
 */
export async function sendCampaignBatch(establishmentId: string, staffId: string, campaignId: string): Promise<CampaignProgress | null> {
  const [campaign] = await sql`
    select c.id, c.title, c.body, c.status, e.name, e.address
    from campaigns c join establishments e on e.id=c.establishment_id
    where c.id=${campaignId} and c.establishment_id=${establishmentId} and c.channel='email'
  `;
  if (!campaign) return null;
  if (campaign.status !== "sending") return progress(campaignId);

  const claimed = await sql`
    update campaign_recipients set claimed_at=now()
    where id in (
      select id from campaign_recipients
      where campaign_id=${campaignId} and status='pending'
        and (claimed_at is null or claimed_at < now() - make_interval(secs => ${CAMPAIGN_CLAIM_LEASE_SECONDS}))
      order by id
      limit ${CAMPAIGN_BATCH_SIZE}
      for update skip locked
    )
    returning id, customer_id
  `;

  const appUrl = getAppUrl();
  for (const recipient of claimed) {
    const customerId = String(recipient.customer_id);
    const [customer] = await sql`
      select email from customers
      where id=${customerId} and establishment_id=${establishmentId}
        and deleted_at is null and marketing_consent=true and email is not null
    `;
    if (!customer) {
      await sql`update campaign_recipients set status='skipped', error='CONSENT_WITHDRAWN' where id=${recipient.id} and status='pending'`;
      continue;
    }
    const token = unsubscribeToken(customerId);
    try {
      await sendCampaignEmail({
        to: String(customer.email),
        restaurantName: String(campaign.name),
        restaurantAddress: campaign.address ? String(campaign.address) : null,
        subject: String(campaign.title),
        message: String(campaign.body),
        unsubscribeUrl: `${appUrl}/unsubscribe/${token}`,
        oneClickUnsubscribeUrl: `${appUrl}/api/unsubscribe/${token}`,
        idempotencyKey: `campaign-${campaignId}-${customerId}`,
      });
      await sql`update campaign_recipients set status='sent', sent_at=now(), error=null where id=${recipient.id} and status='pending'`;
    } catch (error) {
      const code = error instanceof EmailDeliveryError ? error.code : "EMAIL_SEND_FAILED";
      if (code === "EMAIL_NOT_CONFIGURED") {
        // Configuration absente : on libère le lot sans rien marquer, l'envoi pourra reprendre.
        await sql`update campaign_recipients set claimed_at=null where id=${recipient.id} and status='pending'`;
        throw error;
      }
      await sql`update campaign_recipients set status='failed', error=${code.slice(0, 60)} where id=${recipient.id} and status='pending'`;
    }
  }

  // Compteurs recalculés depuis les destinataires : exacts même avec des lots concurrents.
  await sql.begin(async (tx) => {
    const [counts] = await tx`
      select
        count(*) filter (where status='sent')::int as sent,
        count(*) filter (where status='failed')::int as failed,
        count(*) filter (where status='skipped')::int as skipped,
        count(*) filter (where status='pending')::int as pending
      from campaign_recipients where campaign_id=${campaignId}
    `;
    const [updated] = await tx`
      update campaigns set sent_count=${counts.sent}, failed_count=${counts.failed}, skipped_count=${counts.skipped},
        status=case when ${counts.pending}::int = 0 then 'sent' else status end,
        sent_at=case when ${counts.pending}::int = 0 then coalesce(sent_at, now()) else sent_at end,
        completed_at=case when ${counts.pending}::int = 0 then coalesce(completed_at, now()) else completed_at end
      where id=${campaignId} and status='sending'
      returning status
    `;
    if (updated?.status === "sent") {
      await tx`
        insert into audit_logs (establishment_id, staff_user_id, action, entity_type, entity_id, metadata)
        values (${establishmentId}, ${staffId}, 'CAMPAIGN_SENT', 'campaign', ${campaignId},
          ${tx.json({ sent: counts.sent, failed: counts.failed, skipped: counts.skipped })})
      `;
    }
  });
  return progress(campaignId);
}
