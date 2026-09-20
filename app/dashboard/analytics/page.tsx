import Link from "next/link";
import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { getSession } from "@/lib/auth";
import { canAccessBackoffice } from "@/lib/loyalty";
import { sql } from "@/lib/db";
import { ANALYTICS_PERIODS, parseAnalyticsPeriod } from "@/lib/analytics-period";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string | string[] }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!canAccessBackoffice(session.role)) redirect("/s");
  const period = parseAnalyticsPeriod((await searchParams).period);

  const [restaurant] = await sql`select name from establishments where id=${session.establishmentId} limit 1`;
  const [stats] = await sql`
    select
      (select count(*)::int from customers
        where establishment_id=${session.establishmentId}
          and deleted_at is null
          and created_at >= now() - (${period.days}::int * interval '1 day')) as new_customers,
      (select count(distinct card_id)::int from transactions
        where establishment_id=${session.establishmentId}
          and created_at >= now() - (${period.days}::int * interval '1 day')) as active_customers,
      (select count(*)::int from transactions
        where establishment_id=${session.establishmentId}
          and created_at >= now() - (${period.days}::int * interval '1 day')) as transactions,
      (select coalesce(sum(case when delta > 0 then delta else 0 end),0)::int from transactions
        where establishment_id=${session.establishmentId}
          and created_at >= now() - (${period.days}::int * interval '1 day')) as units_issued,
      (select count(*)::int from transactions
        where establishment_id=${session.establishmentId}
          and type='redeem'
          and created_at >= now() - (${period.days}::int * interval '1 day')) as rewards_redeemed,
      (select count(*)::int from (
        select card_id
        from transactions
        where establishment_id=${session.establishmentId}
          and created_at >= now() - (${period.days}::int * interval '1 day')
        group by card_id
        having count(distinct date_trunc('day', created_at at time zone 'Europe/Paris')) >= 2
      ) repeaters) as returning_customers,
      (select count(*)::int from product_events
        where establishment_id=${session.establishmentId}
          and event_type='JOIN_PAGE_VIEW'
          and created_at >= now() - (${period.days}::int * interval '1 day')) as join_views,
      (select count(*)::int from product_events
        where establishment_id=${session.establishmentId}
          and event_type='JOIN_SUBMIT'
          and created_at >= now() - (${period.days}::int * interval '1 day')) as join_submits,
      (select count(*)::int from product_events
        where establishment_id=${session.establishmentId}
          and event_type='SCAN_SUCCESS'
          and created_at >= now() - (${period.days}::int * interval '1 day')) as scan_success,
      (select count(*)::int from product_events
        where establishment_id=${session.establishmentId}
          and event_type='SCAN_FAILED'
          and created_at >= now() - (${period.days}::int * interval '1 day')) as scan_failed,
      (select coalesce(percentile_cont(0.95) within group (order by duration_ms),0)::int from product_events
        where establishment_id=${session.establishmentId}
          and event_type='SCAN_SUCCESS'
          and duration_ms is not null
          and created_at >= now() - (${period.days}::int * interval '1 day')) as scan_p95
  `;

  const daily = await sql`
    select
      (created_at at time zone 'Europe/Paris')::date as day,
      count(*)::int as transactions,
      count(distinct card_id)::int as active_customers,
      coalesce(sum(case when delta > 0 then delta else 0 end),0)::int as units_issued,
      count(*) filter (where type='redeem')::int as rewards_redeemed
    from transactions
    where establishment_id=${session.establishmentId}
      and created_at >= now() - (${period.days}::int * interval '1 day')
    group by (created_at at time zone 'Europe/Paris')::date
    order by day desc
  `;

  const activeCustomers = Number(stats.active_customers || 0);
  const returningCustomers = Number(stats.returning_customers || 0);
  const transactions = Number(stats.transactions || 0);
  const joinViews = Number(stats.join_views || 0);
  const joinSubmits = Number(stats.join_submits || 0);
  const scanSuccess = Number(stats.scan_success || 0);
  const scanFailed = Number(stats.scan_failed || 0);
  const scans = scanSuccess + scanFailed;
  const returningRate = activeCustomers > 0 ? Math.round((returningCustomers / activeCustomers) * 100) : 0;
  const joinConversion = joinViews > 0 ? Math.round((joinSubmits / joinViews) * 100) : 0;
  const scanErrorRate = scans > 0 ? Math.round((scanFailed / scans) * 100) : 0;
  const visitsPerCustomer = activeCustomers > 0 ? (transactions / activeCustomers).toFixed(1) : "0,0";

  return <><AppNav restaurantName={String(restaurant?.name || "Retiko")}/><main className="shell page">
    <div className="section-head">
      <div><span className="eyebrow">Analytics</span><h2 style={{margin:"12px 0 4px"}}>Activité du programme</h2><p className="muted">Des indicateurs exploitables, pas un cockpit de centrale nucléaire.</p></div>
      <div className="actions">
        {canManageProgram(session.role) && <Link className="btn" href="/dashboard/activity">Journal d’activité</Link>}
        {ANALYTICS_PERIODS.map((option) => <Link
          key={option.value}
          className={`btn ${option.value === period.value ? "btn-primary" : ""}`}
          href={`/dashboard/analytics?period=${option.value}`}
        >{option.label}</Link>)}
      </div>
    </div>

    <section className="grid grid-4">
      <div className="card metric"><strong>{stats.new_customers}</strong><span>nouveaux clients</span></div>
      <div className="card metric"><strong>{activeCustomers}</strong><span>clients actifs</span></div>
      <div className="card metric"><strong>{transactions}</strong><span>transactions</span></div>
      <div className="card metric"><strong>{stats.units_issued}</strong><span>unités distribuées</span></div>
    </section>

    <section className="grid grid-4" style={{marginTop:18}}>
      <div className="card metric"><strong>{stats.rewards_redeemed}</strong><span>récompenses utilisées</span></div>
      <div className="card metric"><strong>{returningRate} %</strong><span>clients revenus ≥2 jours</span></div>
      <div className="card metric"><strong>{visitsPerCustomer}</strong><span>transactions / client actif</span></div>
      <div className="card metric"><strong>{joinConversion} %</strong><span>conversion inscription</span></div>
    </section>

    <section className="grid grid-3" style={{marginTop:18}}>
      <div className="card metric"><strong>{scanSuccess}</strong><span>scans réussis</span></div>
      <div className="card metric"><strong>{scanErrorRate} %</strong><span>erreurs scanner</span></div>
      <div className="card metric"><strong>{stats.scan_p95} ms</strong><span>p95 QR → fiche client</span></div>
    </section>

    <section className="card" style={{marginTop:18}}>
      <div className="section-head"><div><h3>Activité quotidienne</h3><p className="muted">Détail des {period.label.toLowerCase()} sélectionnés.</p></div><Link className="btn" href="/dashboard/transactions">Voir les transactions</Link></div>
      {daily.length === 0 ? <div className="empty-state"><strong>Pas encore d’activité sur cette période.</strong><p>Les premiers passages apparaîtront ici dès qu’une carte sera créditée.</p></div> :
        <div className="table-wrap"><table><thead><tr><th>Jour</th><th>Transactions</th><th>Clients actifs</th><th>Unités</th><th>Récompenses</th></tr></thead><tbody>
          {daily.map((row) => <tr key={String(row.day)}><td>{new Date(`${row.day}T12:00:00`).toLocaleDateString("fr-FR")}</td><td>{row.transactions}</td><td>{row.active_customers}</td><td>{row.units_issued}</td><td>{row.rewards_redeemed}</td></tr>)}
        </tbody></table></div>}
    </section>
  </main></>;
}
