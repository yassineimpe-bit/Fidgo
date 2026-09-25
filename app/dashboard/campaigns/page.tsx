import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { CampaignComposer, CampaignResumeButton } from "@/components/campaign-composer";
import { getSession } from "@/lib/auth";
import { recentCampaignDates } from "@/lib/campaign-store";
import {
  CAMPAIGN_KIND_LABELS, CAMPAIGNS_PER_WEEK, CUSTOMER_COOLDOWN_DAYS, isMissingCampaignSchema, nextCampaignAllowedAt, segmentLabel,
  type CampaignKind, type CampaignSegment,
} from "@/lib/campaigns";
import { sql } from "@/lib/db";
import { campaignEmailTestMode, emailDeliveryConfigured } from "@/lib/email";
import { canAccessBackoffice, canSendCampaigns } from "@/lib/loyalty";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = { sending: "Envoi en cours", sent: "Envoyée" };

async function loadCampaigns(establishmentId: string) {
  try {
    const campaigns = await sql`
      select id, kind, segment, inactive_days, title, status, recipient_count, sent_count, failed_count, skipped_count, created_at
      from campaigns where establishment_id=${establishmentId} and channel='email'
      order by created_at desc limit 50
    `;
    return { available: true as const, campaigns, nextAllowedAt: nextCampaignAllowedAt(await recentCampaignDates(sql, establishmentId)) };
  } catch (error) {
    if (isMissingCampaignSchema(error)) return { available: false as const };
    throw error;
  }
}

export default async function CampaignsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!canAccessBackoffice(session.role)) redirect("/s");

  const [restaurant] = await sql`select name from establishments where id=${session.establishmentId}`;
  const [audience] = await sql`
    select count(*) filter (where marketing_consent and email is not null)::int as subscribed, count(*)::int as total
    from customers where establishment_id=${session.establishmentId} and deleted_at is null
  `;
  const state = await loadCampaigns(session.establishmentId);
  const canSend = canSendCampaigns(session.role);
  const emailReady = emailDeliveryConfigured() || campaignEmailTestMode();

  return <><AppNav restaurantName={restaurant?.name}/><main className="shell page">
    <div className="section-head"><div><span className="eyebrow">Campagnes</span><h2 style={{margin:"12px 0 4px"}}>E-mails à vos clients</h2>
      <p className="muted">{audience.subscribed} client(s) sur {audience.total} ont accepté de recevoir vos offres par e-mail.</p></div></div>

    <section className="card" style={{marginBottom:18}}>
      <h3>Règles d’envoi</h3>
      <ul className="muted" style={{lineHeight:1.7,paddingLeft:20,margin:0}}>
        <li>Seuls les clients qui ont eux-mêmes accepté vos offres reçoivent un e-mail ; chacun peut se désabonner en un clic.</li>
        <li>Au plus {CAMPAIGNS_PER_WEEK} campagnes par période de 7 jours.</li>
        <li>Un client reçoit au plus un e-mail tous les {CUSTOMER_COOLDOWN_DAYS} jours, même si plusieurs campagnes le ciblent.</li>
      </ul>
    </section>

    {!state.available
      ? <section className="card"><p className="muted">Les campagnes ne sont pas encore disponibles sur ce serveur (mise à jour de la base en attente).</p></section>
      : <>
        {canSend && (!emailReady
          ? <section className="card"><p className="muted">L’envoi d’e-mails n’est pas encore configuré sur Retiko.</p></section>
          : state.nextAllowedAt
            ? <section className="card"><p className="notice" role="status">Limite atteinte : prochaine campagne possible le {state.nextAllowedAt.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" })}.</p></section>
            : <CampaignComposer restaurantName={String(restaurant?.name ?? "")}/>)}

        <section className="card" style={{marginTop:18}}>
          <h3>Historique</h3>
          {state.campaigns.length ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Ciblage</th><th>Objet</th><th>Envoyés</th><th>Statut</th></tr></thead><tbody>
            {state.campaigns.map((campaign) => <tr key={String(campaign.id)}>
              <td>{new Date(campaign.created_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" })}</td>
              <td>{CAMPAIGN_KIND_LABELS[campaign.kind as CampaignKind] ?? String(campaign.kind)}</td>
              <td>{segmentLabel(campaign.segment as CampaignSegment, campaign.inactive_days === null ? null : Number(campaign.inactive_days))}</td>
              <td>{String(campaign.title)}</td>
              <td>{Number(campaign.sent_count)} / {Number(campaign.recipient_count)}{Number(campaign.failed_count) ? ` (${Number(campaign.failed_count)} échec(s))` : ""}</td>
              <td>{STATUS_LABELS[String(campaign.status)] ?? String(campaign.status)}{campaign.status === "sending" && canSend && <> <CampaignResumeButton id={String(campaign.id)}/></>}</td>
            </tr>)}
          </tbody></table></div> : <p className="muted">Aucune campagne envoyée pour le moment.</p>}
        </section>
      </>}
  </main></>;
}
