import Link from "next/link";
import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { getSession } from "@/lib/auth";
import { canAccessBackoffice, canManageProgram } from "@/lib/loyalty";
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
          and created_at >= now() - (${period.days}::int * interval '1 day')) as scan_p95,
      (select coalesce(round(avg(extract(epoch from (visit_at - previous_visit_at)) / 3600)::numeric,1),0)
        from (
          select card_id, created_at as visit_at,
            lag(created_at) over (partition by card_id order by created_at) as previous_visit_at
          from transactions
          where establishment_id=${session.establishmentId} and type='earn'
        ) visits
        where previous_visit_at is not null
          and visit_at >= now() - (${period.days}::int * interval '1 day')) as avg_gap_hours,
      (select coalesce(round(avg(visits_before)::numeric,1),0)
        from (
          select r.id,
            (select count(*)::numeric
              from transactions e
              where e.establishment_id=r.establishment_id
                and e.card_id=r.card_id
                and e.type='earn'
                and e.created_at <= r.created_at
                and e.created_at > coalesce((
                  select max(previous_redeem.created_at)
                  from transactions previous_redeem
                  where previous_redeem.establishment_id=r.establishment_id
                    and previous_redeem.card_id=r.card_id
                    and previous_redeem.type='redeem'
                    and previous_redeem.created_at < r.created_at
                ), '-infinity'::timestamptz)
            ) as visits_before
          from transactions r
          where r.establishment_id=${session.establishmentId}
            and r.type='redeem'
            and r.created_at >= now() - (${period.days}::int * interval '1 day')
        ) reward_cycles) as visits_before_reward,
      (select count(*)::int
        from cards c
        join customers u on u.id=c.customer_id
        where c.establishment_id=${session.establishmentId}
          and c.active=true and u.deleted_at is null
          and coalesce((
            select max(t.created_at) from transactions t
            where t.card_id=c.id and t.type='earn'
          ), c.created_at) < now()-interval '30 days'
          and coalesce((
            select max(t.created_at) from transactions t
            where t.card_id=c.id and t.type='earn'
          ), c.created_at) >= now()-interval '90 days') as inactive_customers,
      (select count(*)::int
        from cards c
        join customers u on u.id=c.customer_id
        where c.establishment_id=${session.establishmentId}
          and c.active=true and u.deleted_at is null
          and coalesce((
            select max(t.created_at) from transactions t
            where t.card_id=c.id and t.type='earn'
          ), c.created_at) < now()-interval '90 days') as lost_customers,
      (select count(*)::int
        from cards c
        join customers u on u.id=c.customer_id
        join loyalty_programs p on p.establishment_id=c.establishment_id
        where c.establishment_id=${session.establishmentId}
          and c.active=true and u.deleted_at is null and p.active=true
          and c.balance >= p.reward_threshold) as rewards_available
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

  const hourly = await sql`
    with visits as (
      select extract(hour from created_at at time zone 'Europe/Paris')::int as hour,
             count(*)::int as visits
      from transactions
      where establishment_id=${session.establishmentId}
        and type='earn'
        and created_at >= now() - (${period.days}::int * interval '1 day')
      group by 1
    )
    select hours.hour,coalesce(visits.visits,0)::int as visits
    from generate_series(0,23) as hours(hour)
    left join visits using(hour)
    order by hours.hour
  `;

  const cohorts = await sql`
    select
      date_trunc('month', u.created_at at time zone 'Europe/Paris')::date as cohort,
      count(*)::int as customers,
      count(*) filter (
        where exists (
          select 1
          from cards c
          join transactions t on t.card_id=c.id
          where c.customer_id=u.id
            and t.created_at >= now() - (${period.days}::int * interval '1 day')
        )
      )::int as active_customers
    from customers u
    where u.establishment_id=${session.establishmentId}
      and u.deleted_at is null
      and u.created_at >= date_trunc('month', now() at time zone 'Europe/Paris') - interval '5 months'
    group by 1
    order by cohort desc
  `;

  const rfm = await sql`
    with base as (
      select
        c.id as card_id,
        greatest(0,floor(extract(epoch from (now()-coalesce(max(t.created_at),c.created_at))) / 86400))::int as recency_days,
        count(t.id)::int as frequency,
        coalesce(sum(
          case
            when t.metadata->>'purchaseAmountCents' ~ '^[0-9]+$'
              then (t.metadata->>'purchaseAmountCents')::numeric
            else 0
          end
        ),0)::bigint as monetary_cents
      from cards c
      join customers u on u.id=c.customer_id
      left join transactions t on t.card_id=c.id
        and t.type='earn'
        and t.created_at >= now() - (${period.days}::int * interval '1 day')
      where c.establishment_id=${session.establishmentId}
        and c.active=true and u.deleted_at is null
      group by c.id,c.created_at
    ),
    scored as (
      select *,
        ntile(5) over(order by recency_days desc,card_id) as r_score,
        ntile(5) over(order by frequency asc,card_id) as f_score,
        ntile(5) over(order by monetary_cents asc,card_id) as m_score
      from base
    ),
    segmented as (
      select *,
        case
          when r_score>=4 and f_score>=4 and m_score>=3 then 'Champions'
          when f_score>=4 then 'Fidèles'
          when r_score<=2 then 'À réactiver'
          when r_score>=4 and frequency<=1 then 'Nouveaux'
          else 'À développer'
        end as segment
      from scored
    )
    select segment,count(*)::int as customers,
      round(avg(recency_days)::numeric,1) as avg_recency_days,
      round(avg(frequency)::numeric,1) as avg_frequency,
      round(avg(monetary_cents)::numeric/100,2) as avg_monetary_euros
    from segmented
    group by segment
    order by count(*) desc,segment
  `;

  const activeCustomers = Number(stats.active_customers || 0);
  const returningCustomers = Number(stats.returning_customers || 0);
  const transactions = Number(stats.transactions || 0);
  const joinViews = Number(stats.join_views || 0);
  const joinSubmits = Number(stats.join_submits || 0);
  const scanSuccess = Number(stats.scan_success || 0);
  const scanFailed = Number(stats.scan_failed || 0);
  const scans = scanSuccess + scanFailed;
  const rewardsRedeemed = Number(stats.rewards_redeemed || 0);
  const rewardsAvailable = Number(stats.rewards_available || 0);
  const rewardOpportunities = rewardsRedeemed + rewardsAvailable;
  const returningRate = activeCustomers > 0 ? Math.round((returningCustomers / activeCustomers) * 100) : 0;
  const joinConversion = joinViews > 0 ? Math.round((joinSubmits / joinViews) * 100) : 0;
  const scanErrorRate = scans > 0 ? Math.round((scanFailed / scans) * 100) : 0;
  const visitsPerCustomer = activeCustomers > 0 ? (transactions / activeCustomers).toFixed(1) : "0,0";
  const rewardUsageRate = rewardOpportunities > 0 ? Math.round((rewardsRedeemed / rewardOpportunities) * 100) : 0;

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

    <section className="grid grid-4" style={{marginTop:18}}>
      <div className="card metric"><strong>{stats.avg_gap_hours} h</strong><span>délai moyen entre visites</span></div>
      <div className="card metric"><strong>{stats.visits_before_reward}</strong><span>visites moyennes avant récompense</span></div>
      <div className="card metric"><strong>{rewardUsageRate} %</strong><span>taux d’utilisation des récompenses</span></div>
      <div className="card metric"><strong>{rewardsAvailable}</strong><span>récompenses disponibles</span></div>
    </section>

    <section className="grid grid-4" style={{marginTop:18}}>
      <div className="card metric"><strong>{stats.inactive_customers}</strong><span>clients inactifs 30–89 j</span></div>
      <div className="card metric"><strong>{stats.lost_customers}</strong><span>clients perdus ≥90 j</span></div>
      <div className="card metric"><strong>{scanSuccess}</strong><span>scans réussis</span></div>
      <div className="card metric"><strong>{scanErrorRate} %</strong><span>erreurs scanner</span></div>
    </section>

    <section className="grid grid-2" style={{marginTop:18}}>
      <div className="card">
        <h3>Fréquentation par heure</h3>
        <p className="muted">Visites créditées, heure locale Europe/Paris.</p>
        <div className="table-wrap"><table><thead><tr><th>Heure</th><th>Visites</th></tr></thead><tbody>
          {hourly.map((row) => <tr key={String(row.hour)}><td>{String(row.hour).padStart(2,"0")}h</td><td>{row.visits}</td></tr>)}
        </tbody></table></div>
      </div>
      <div className="card">
        <h3>Cohortes</h3>
        <p className="muted">Clients inscrits par mois et encore actifs sur la période sélectionnée.</p>
        {cohorts.length === 0 ? <div className="empty-state"><strong>Aucune cohorte.</strong></div> : <div className="table-wrap"><table><thead><tr><th>Cohorte</th><th>Inscrits</th><th>Actifs</th><th>Taux</th></tr></thead><tbody>
          {cohorts.map((row) => {
            const total = Number(row.customers || 0);
            const active = Number(row.active_customers || 0);
            const rate = total > 0 ? Math.round((active / total) * 100) : 0;
            return <tr key={String(row.cohort)}><td>{new Date(`${row.cohort}T12:00:00`).toLocaleDateString("fr-FR",{month:"short",year:"numeric"})}</td><td>{total}</td><td>{active}</td><td>{rate} %</td></tr>;
          })}
        </tbody></table></div>}
      </div>
    </section>

    <section className="card" style={{marginTop:18}}>
      <div className="section-head"><div><h3>Segmentation RFM</h3><p className="muted">Récence, fréquence et montant d’achat connu. Les passages sans montant saisi contribuent à 0 € au score M.</p></div></div>
      {rfm.length === 0 ? <div className="empty-state"><strong>Aucun client à segmenter.</strong></div> : <div className="table-wrap"><table><thead><tr><th>Segment</th><th>Clients</th><th>Récence moy.</th><th>Fréquence moy.</th><th>Montant moy.</th></tr></thead><tbody>
        {rfm.map((row) => <tr key={String(row.segment)}><td>{row.segment}</td><td>{row.customers}</td><td>{row.avg_recency_days} j</td><td>{row.avg_frequency}</td><td>{Number(row.avg_monetary_euros).toLocaleString("fr-FR",{style:"currency",currency:"EUR"})}</td></tr>)}
      </tbody></table></div>}
    </section>

    <section className="grid grid-2" style={{marginTop:18}}>
      <div className="card metric"><strong>{stats.scan_p95} ms</strong><span>p95 QR → fiche client</span></div>
      <div className="card metric"><strong>{period.label}</strong><span>période analysée</span></div>
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
