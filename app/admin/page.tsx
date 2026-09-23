import Link from "next/link";
import { AdminNav, formatDate } from "@/components/admin-nav";
import { activityActionLabel } from "@/lib/activity-log";
import { sql } from "@/lib/db";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { collectServiceStatus, type ServiceState } from "@/lib/service-status";

export const dynamic = "force-dynamic";

const STATE_BADGE: Record<ServiceState, { label: string; className: string }> = {
  up: { label: "OK", className: "badge success" },
  off: { label: "Désactivé", className: "badge" },
  incomplete: { label: "À compléter", className: "badge warning" },
  down: { label: "En panne", className: "badge warning" },
};

export default async function AdminOverviewPage() {
  const admin = await requirePlatformAdmin("overview");

  const [totals] = await sql`
    select
      (select count(*)::int from establishments) as establishments,
      (select count(*)::int from establishments where status='active') as active_establishments,
      (select count(*)::int from establishments where platform_suspended_at is not null) as platform_suspended,
      (select count(*)::int from establishments where created_at >= now() - interval '7 days') as signups_7d,
      (select count(*)::int from staff_users where active) as active_staff,
      (select count(*)::int from customers where deleted_at is null) as customers,
      (select count(*)::int from transactions where type='earn' and created_at >= (date_trunc('day', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris')) as scans_today,
      (select count(*)::int from transactions where type='earn' and created_at >= now() - interval '7 days') as scans_7d,
      (select count(*)::int from transactions where type='earn' and created_at >= now() - interval '30 days') as scans_30d,
      (select count(distinct establishment_id)::int from transactions where type='earn' and created_at >= now() - interval '7 days') as scanning_establishments_7d
  `;

  const daily = await sql`
    select d::date as day, coalesce(t.count, 0)::int as count
    from generate_series(
      (now() at time zone 'Europe/Paris')::date - 13,
      (now() at time zone 'Europe/Paris')::date,
      interval '1 day'
    ) d
    left join (
      select (created_at at time zone 'Europe/Paris')::date as day, count(*)::int as count
      from transactions
      where type='earn' and created_at >= now() - interval '15 days'
      group by 1
    ) t on t.day = d::date
    order by d
  `;
  const maxDaily = Math.max(1, ...daily.map((row) => Number(row.count)));

  const errors = await sql`
    select e.id, e.name,
      count(*) filter (where pe.event_type='SCAN_FAILED' and pe.created_at >= now() - interval '24 hours')::int as scan_failed_24h,
      count(*) filter (where pe.event_type='SCAN_FAILED')::int as scan_failed_7d,
      count(*) filter (where pe.event_type='CAMERA_FAILED')::int as camera_failed_7d
    from product_events pe
    join establishments e on e.id = pe.establishment_id
    where pe.event_type in ('SCAN_FAILED','CAMERA_FAILED') and pe.created_at >= now() - interval '7 days'
    group by e.id, e.name
    order by count(*) desc, e.name
    limit 10
  `;
  const [errorTotals] = await sql`
    select
      (select count(*)::int from wallet_passes where status='error') as wallet_errors,
      (select count(*)::int from subscriptions where status in ('past_due','unpaid')) as payment_issues
  `;

  const activity = await sql`
    select a.id, a.action, a.created_at, e.id as establishment_id, e.name as establishment
    from audit_logs a
    left join establishments e on e.id = a.establishment_id
    order by a.created_at desc
    limit 15
  `;
  const signups = await sql`
    select id, name, created_at from establishments order by created_at desc limit 8
  `;
  const services = await collectServiceStatus();

  const metrics = [
    [totals.establishments, "commerces", `${totals.active_establishments} actifs · ${totals.platform_suspended} suspendus par Retiko`],
    [totals.signups_7d, "inscriptions 7 j", "nouveaux commerces"],
    [totals.active_staff, "comptes staff actifs", "tous commerces"],
    [totals.customers, "clients", "cartes non effacées"],
    [totals.scans_today, "scans aujourd’hui", "crédits validés (Paris)"],
    [totals.scans_7d, "scans 7 j", `${totals.scanning_establishments_7d} commerces actifs`],
    [totals.scans_30d, "scans 30 j", "crédits validés"],
  ] as const;

  return <>
    <AdminNav email={admin.email}/>
    <main className="shell page">
      <div className="section-head"><div>
        <span className="eyebrow">Plateforme</span>
        <h2 style={{margin:"12px 0 4px"}}>Vue d’ensemble</h2>
        <p className="muted">Données agrégées tous commerces. Aucune donnée client individuelle n’est affichée ici.</p>
      </div></div>

      <section className="grid grid-4" style={{marginBottom:18}} aria-label="Indicateurs plateforme">
        {metrics.map(([value, label, hint]) => <div key={label} className="card metric"><strong>{Number(value)}</strong><span>{label}</span><div className="muted" style={{fontSize:12}}>{hint}</div></div>)}
      </section>

      <div className="grid grid-2" style={{marginBottom:18}}>
        <section className="card" aria-labelledby="services-title">
          <h3 id="services-title">État des services</h3>
          <div className="table-wrap"><table>
            <thead><tr><th>Service</th><th>État</th><th>Détail</th></tr></thead>
            <tbody>{services.map((line) => <tr key={line.name}>
              <td>{line.name}</td>
              <td><span className={STATE_BADGE[line.state].className}>{STATE_BADGE[line.state].label}</span></td>
              <td className="muted">{line.detail}</td>
            </tr>)}</tbody>
          </table></div>
          <p className="muted" style={{fontSize:13,marginBottom:0}}>Disponibilité externe : workflow <code>production-monitor</code> (issue « [monitoring] Retiko production incident »).</p>
        </section>

        <section className="card" aria-labelledby="volume-title">
          <h3 id="volume-title">Volume de scans · 14 jours</h3>
          <div className="table-wrap"><table>
            <thead><tr><th>Jour</th><th>Scans</th><th aria-hidden="true"></th></tr></thead>
            <tbody>{daily.map((row) => <tr key={String(row.day)}>
              <td>{new Date(String(row.day)).toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" })}</td>
              <td>{Number(row.count)}</td>
              <td style={{width:"50%"}}><div aria-hidden="true" style={{height:8,borderRadius:999,background:"var(--line)"}}><div style={{height:8,borderRadius:999,background:"var(--brand, #111)",width:`${Math.round(Number(row.count) / maxDaily * 100)}%`}}/></div></td>
            </tr>)}</tbody>
          </table></div>
        </section>
      </div>

      <div className="grid grid-2" style={{marginBottom:18}}>
        <section className="card" aria-labelledby="errors-title">
          <h3 id="errors-title">Erreurs</h3>
          <p className="muted">Passes Wallet en erreur : <strong>{Number(errorTotals.wallet_errors)}</strong> · Abonnements impayés / en retard : <strong>{Number(errorTotals.payment_issues)}</strong></p>
          {errors.length === 0
            ? <div className="empty-state"><strong>Aucun échec scanner sur 7 jours.</strong></div>
            : <div className="table-wrap"><table>
                <thead><tr><th>Commerce</th><th>Scans échoués 24 h</th><th>Scans échoués 7 j</th><th>Caméra 7 j</th></tr></thead>
                <tbody>{errors.map((row) => <tr key={String(row.id)}>
                  <td><Link href={`/admin/establishments/${row.id}`}>{String(row.name)}</Link></td>
                  <td>{Number(row.scan_failed_24h)}</td><td>{Number(row.scan_failed_7d)}</td><td>{Number(row.camera_failed_7d)}</td>
                </tr>)}</tbody>
              </table></div>}
          <p className="muted" style={{fontSize:13,marginBottom:0}}>Exceptions serveur et navigateur : Vercel Runtime Logs, clés <code>RETIKO_SERVER_ERROR</code> et <code>RETIKO_CLIENT_ERROR</code> (voir docs/OBSERVABILITY.md).</p>
        </section>

        <section className="card" aria-labelledby="activity-title">
          <h3 id="activity-title">Activité récente</h3>
          <div className="table-wrap"><table>
            <thead><tr><th>Date</th><th>Commerce</th><th>Action</th></tr></thead>
            <tbody>
              {activity.map((row) => <tr key={String(row.id)}>
                <td>{formatDate(row.created_at)}</td>
                <td>{row.establishment_id ? <Link href={`/admin/establishments/${row.establishment_id}`}>{String(row.establishment)}</Link> : "—"}</td>
                <td>{activityActionLabel(String(row.action))}</td>
              </tr>)}
              {activity.length === 0 && <tr><td colSpan={3} className="muted">Aucune activité journalisée.</td></tr>}
            </tbody>
          </table></div>
          <h4 style={{marginBottom:8}}>Dernières inscriptions</h4>
          <ul style={{margin:0,paddingLeft:18}}>
            {signups.map((row) => <li key={String(row.id)}><Link href={`/admin/establishments/${row.id}`}>{String(row.name)}</Link> <span className="muted">· {formatDate(row.created_at)}</span></li>)}
          </ul>
        </section>
      </div>
    </main>
  </>;
}
