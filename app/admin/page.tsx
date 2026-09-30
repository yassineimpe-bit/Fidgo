import Link from "next/link";
import { AdminBar, AdminMetric, AdminWatchList } from "@/components/admin-metrics";
import { AdminNav, formatDate } from "@/components/admin-nav";
import { activityActionLabel } from "@/lib/activity-log";
import { sql } from "@/lib/db";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import {
  WATCH_RULES, establishmentUsage, formatCalendarDate, formatDuration, formatMs, formatPercent, formatRatio,
  ratePercent, rewardUsageRate, scanErrorRate,
} from "@/lib/platform-metrics";
import { collectServiceStatus, type ServiceState } from "@/lib/service-status";

export const dynamic = "force-dynamic";

const STATE_BADGE: Record<ServiceState, { label: string; className: string }> = {
  up: { label: "OK", className: "badge success" },
  off: { label: "Désactivé", className: "badge" },
  incomplete: { label: "À compléter", className: "badge warning" },
  down: { label: "En panne", className: "badge warning" },
};

const WATCH_LIMIT = 30;

export default async function AdminOverviewPage() {
  const admin = await requirePlatformAdmin("overview");
  const now = new Date();

  // Une seule passe groupée sur chaque table ; les totaux sont la somme des
  // indicateurs par commerce, donc identiques à ceux de la liste des commerces.
  const [totals] = await sql`
    with u as (${establishmentUsage(sql`true`)})
    select
      count(*)::int as establishments,
      count(*) filter (where status='active')::int as open_establishments,
      count(*) filter (where platform_suspended_at is not null)::int as platform_suspended,
      count(*) filter (where status='suspended' and platform_suspended_at is null)::int as closed_by_merchant,
      count(*) filter (where created_at >= now() - interval '7 days')::int as signups_7d,
      count(*) filter (where onboarding_step is not null)::int as onboarding_tracked,
      count(*) filter (where onboarding_step = 5)::int as onboarding_done,
      count(*) filter (where program_active)::int as program_active,
      count(*) filter (where customers > 0)::int as with_customers,
      count(*) filter (where first_earn_at is not null)::int as activated,
      count(*) filter (where redeem_total > 0)::int as with_redeem,
      percentile_cont(0.5) within group (order by extract(epoch from (first_earn_at - created_at)))
        filter (where first_earn_at is not null) as median_activation_seconds,
      count(*) filter (where earn_24h > 0)::int as active_24h,
      count(*) filter (where earn_7d > 0)::int as active_7d,
      count(*) filter (where earn_30d > 0)::int as active_30d,
      count(*) filter (where earn_days_7d >= 2)::int as recurring_7d,
      coalesce(sum(earn_7d),0)::int as earn_7d,
      coalesce(sum(earn_30d),0)::int as earn_30d,
      coalesce(sum(customers),0)::int as customers,
      coalesce(sum(new_customers_30d),0)::int as new_customers_30d,
      coalesce(sum(active_customers_30d),0)::int as active_customers_30d,
      coalesce(sum(returning_customers_30d),0)::int as returning_customers_30d,
      coalesce(sum(rewards_30d),0)::int as rewards_30d,
      coalesce(sum(rewards_available),0)::int as rewards_available,
      coalesce(sum(scan_success_24h),0)::int as scan_success_24h,
      coalesce(sum(scan_failed_24h),0)::int as scan_failed_24h,
      coalesce(sum(scan_success_7d),0)::int as scan_success_7d,
      coalesce(sum(scan_failed_7d),0)::int as scan_failed_7d,
      coalesce(sum(camera_failed_7d),0)::int as camera_failed_7d,
      count(*) filter (where scan_failed_7d > 0 or camera_failed_7d > 0)::int as establishments_with_scan_errors,
      coalesce(sum(wallet_apple_active),0)::int as wallet_apple_active,
      coalesce(sum(wallet_google_active),0)::int as wallet_google_active,
      coalesce(sum(wallet_errors),0)::int as wallet_errors,
      count(*) filter (where watch_never_started or watch_dropped or watch_trial_at_risk or watch_scanner)::int as watch_count,
      -- Commerces à surveiller ou en erreur, dans la même passe (aucun second calcul).
      coalesce(jsonb_agg(to_jsonb(u) order by created_at desc, id) filter (
        where watch_never_started or watch_dropped or watch_trial_at_risk or watch_scanner
          or scan_failed_7d > 0 or camera_failed_7d > 0 or wallet_errors > 0
      ), '[]'::jsonb) as flagged
    from u
  `;
  const flagged = (Array.isArray(totals.flagged) ? totals.flagged : []) as Record<string, unknown>[];
  // Priorité : l'urgence datée (fin d'essai), puis la panne, puis le décrochage, puis le démarrage.
  const watchRows = flagged
    .filter((row) => row.watch_never_started || row.watch_dropped || row.watch_trial_at_risk || row.watch_scanner)
    .map((row) => ({ row, rank: row.watch_trial_at_risk ? 0 : row.watch_scanner ? 1 : row.watch_dropped ? 2 : 3 }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ row }) => row);
  const errorRows = flagged
    .filter((row) => Number(row.scan_failed_7d) > 0 || Number(row.camera_failed_7d) > 0 || Number(row.wallet_errors) > 0)
    .sort((a, b) => Number(b.scan_failed_7d) + Number(b.wallet_errors) - Number(a.scan_failed_7d) - Number(a.wallet_errors))
    .slice(0, 10);

  const [scanner] = await sql`
    select round(percentile_cont(0.95) within group (order by duration_ms))::int as p95
    from product_events
    where event_type='SCAN_SUCCESS' and duration_ms is not null and created_at >= now() - interval '7 days'
  `;
  const [payments] = await sql`select count(*)::int as issues from subscriptions where status in ('past_due','unpaid')`;

  const daily = await sql`
    select d::date as day, coalesce(t.earn,0)::int as earn, coalesce(t.establishments,0)::int as establishments
    from generate_series(
      (now() at time zone 'Europe/Paris')::date - 29,
      (now() at time zone 'Europe/Paris')::date,
      interval '1 day'
    ) d
    left join (
      select (created_at at time zone 'Europe/Paris')::date as day,
        count(*)::int as earn, count(distinct establishment_id)::int as establishments
      from transactions
      where type='earn' and created_at >= now() - interval '31 days'
      group by 1
    ) t on t.day = d::date
    order by d desc
  `;
  const maxDaily = Math.max(1, ...daily.map((row) => Number(row.earn)));

  const activity = await sql`
    select a.id, a.action, a.created_at, e.id as establishment_id, e.name as establishment
    from audit_logs a
    left join establishments e on e.id = a.establishment_id
    order by a.created_at desc
    limit 15
  `;
  const signups = await sql`select id, name, created_at from establishments order by created_at desc limit 8`;
  const services = await collectServiceStatus();

  const n = (key: string) => Number(totals[key] ?? 0);
  const registered = n("establishments");
  const activeCustomers = n("active_customers_30d");

  return <>
    <AdminNav email={admin.email}/>
    <main className="shell page admin-cockpit">
      <div className="section-head"><div>
        <span className="eyebrow">Plateforme</span>
        <h2 style={{margin:"12px 0 4px"}}>Vue d’ensemble</h2>
        <p className="muted">Données agrégées tous commerces. Aucune donnée client individuelle n’est affichée ici. Un commerce est <strong>actif</strong> s’il a au moins un passage crédité (<code>earn</code>) sur la période ; un ajustement, une annulation ou une récompense seule ne comptent pas.</p>
      </div></div>

      {registered === 0 && <div className="empty-state card" style={{marginBottom:18}}>
        <strong>Aucun commerce inscrit pour l’instant.</strong>
        <p>Les indicateurs se rempliront dès la première inscription commerçant.</p>
      </div>}

      <section aria-labelledby="activation-title" style={{marginBottom:18}}>
        <h3 id="activation-title">Activation des commerces</h3>
        <div className="grid grid-4">
          <AdminMetric value={registered} label="commerces inscrits" hint={`${n("signups_7d")} sur 7 j`}/>
          <AdminMetric value={n("open_establishments")} label="ouverts" hint={`${n("platform_suspended")} suspendus par Retiko · ${n("closed_by_merchant")} fermés par le commerçant`}/>
          <AdminMetric value={formatPercent(ratePercent(n("activated"), registered))} label="taux d’activation" hint={`${n("activated")} / ${registered} avec ≥ 1 passage crédité`}/>
          <AdminMetric value={formatDuration(totals.median_activation_seconds)} label="délai médian inscription → 1er passage" hint={n("activated") ? `sur ${n("activated")} commerce${n("activated") > 1 ? "s" : ""} activé${n("activated") > 1 ? "s" : ""}` : "aucun commerce activé"}/>
          <AdminMetric value={`${n("onboarding_done")} / ${n("onboarding_tracked")}`} label="onboarding guidé terminé" hint={registered - n("onboarding_tracked") ? `${registered - n("onboarding_tracked")} inscrits avant le parcours guidé (non suivis)` : "tous les commerces sont suivis"}/>
          <AdminMetric value={n("program_active")} label="programme actif" hint="le programme est créé à l’inscription"/>
          <AdminMetric value={n("with_customers")} label="avec ≥ 1 client" hint="client non effacé"/>
          <AdminMetric value={n("with_redeem")} label="avec ≥ 1 récompense utilisée" hint="depuis l’inscription"/>
        </div>
      </section>

      <section aria-labelledby="usage-title" style={{marginBottom:18}}>
        <h3 id="usage-title">Usage réel</h3>
        <div className="grid grid-4">
          <AdminMetric value={n("active_24h")} label="commerces actifs 24 h" hint="≥ 1 passage crédité"/>
          <AdminMetric value={n("active_7d")} label="commerces actifs 7 j"/>
          <AdminMetric value={n("active_30d")} label="commerces actifs 30 j"/>
          <AdminMetric value={n("recurring_7d")} label="commerces récurrents 7 j" hint="passages crédités sur ≥ 2 jours distincts (Paris)"/>
          <AdminMetric value={n("earn_7d")} label="passages crédités 7 j"/>
          <AdminMetric value={n("earn_30d")} label="passages crédités 30 j"/>
        </div>
      </section>

      <section className="card" aria-labelledby="watch-title" style={{marginBottom:18}}>
        <div className="section-head" style={{marginBottom:8}}>
          <h3 id="watch-title" style={{margin:0}}>À surveiller <span className="badge">{n("watch_count")}</span></h3>
          {n("watch_count") > 0 && <Link className="btn" href="/admin/establishments?watch=1">Voir dans la liste</Link>}
        </div>
        <p className="muted" style={{fontSize:13}}>
          Règles fixes, commerces ouverts uniquement : inscrit depuis plus de {WATCH_RULES.neverStartedAfterDays} j sans passage crédité ·
          aucun passage crédité depuis ≥ {WATCH_RULES.droppedAfterDays} j après avoir démarré ·
          essai terminé sous {WATCH_RULES.trialEndingWithinDays} j sans passage crédité sur 7 j ·
          scanner ≥ {WATCH_RULES.scannerFailurePercent} % d’échecs sur au moins {WATCH_RULES.scannerMinAttempts7d} tentatives en 7 j.
          Aucune action automatique.
        </p>
        <AdminWatchList rows={watchRows.slice(0, WATCH_LIMIT)} now={now} emptyText="Aucun commerce ouvert ne déclenche une règle de surveillance."/>
        {watchRows.length > WATCH_LIMIT && <p className="muted">{watchRows.length - WATCH_LIMIT} autres : <Link href="/admin/establishments?watch=1">liste complète</Link>.</p>}
      </section>

      <section aria-labelledby="loyalty-title" style={{marginBottom:18}}>
        <h3 id="loyalty-title">Fidélisation · 30 derniers jours</h3>
        <p className="muted" style={{fontSize:13}}>Mêmes définitions que l’analytics commerçant : client actif = au moins un passage crédité ; client revenu = passages crédités sur au moins 2 jours distincts ; taux d’utilisation = récompenses utilisées / (utilisées + disponibles aujourd’hui).</p>
        <div className="grid grid-4">
          <AdminMetric value={n("new_customers_30d")} label="nouveaux clients" hint={`${n("customers")} clients au total`}/>
          <AdminMetric value={activeCustomers} label="clients actifs"/>
          <AdminMetric value={n("returning_customers_30d")} label="clients revenus ≥ 2 jours" hint={`taux de retour ${formatPercent(ratePercent(n("returning_customers_30d"), activeCustomers))}`}/>
          <AdminMetric value={formatRatio(n("earn_30d"), activeCustomers)} label="passages crédités / client actif"/>
          <AdminMetric value={n("rewards_30d")} label="récompenses utilisées"/>
          <AdminMetric value={n("rewards_available")} label="récompenses disponibles" hint="solde ≥ seuil, aujourd’hui"/>
          <AdminMetric value={formatPercent(rewardUsageRate(n("rewards_30d"), n("rewards_available")))} label="taux d’utilisation des récompenses"/>
        </div>
      </section>

      <section aria-labelledby="health-title" style={{marginBottom:18}}>
        <h3 id="health-title">Santé technique</h3>
        <div className="grid grid-4" style={{marginBottom:18}}>
          <AdminMetric value={formatPercent(scanErrorRate(n("scan_success_24h"), n("scan_failed_24h")))} label="échec scanner 24 h" hint={`${n("scan_failed_24h")} échecs · ${n("scan_success_24h")} réussis`}/>
          <AdminMetric value={formatPercent(scanErrorRate(n("scan_success_7d"), n("scan_failed_7d")))} label="échec scanner 7 j" hint={`${n("scan_failed_7d")} échecs · ${n("scan_success_7d")} réussis`}/>
          <AdminMetric value={formatMs(scanner?.p95)} label="p95 scanner 7 j" hint="QR détecté → fiche client, scans réussis"/>
          <AdminMetric value={n("establishments_with_scan_errors")} label="commerces avec erreurs scanner 7 j" hint={`${n("camera_failed_7d")} échecs caméra`}/>
          <AdminMetric value={n("wallet_apple_active")} label="passes Apple actives"/>
          <AdminMetric value={n("wallet_google_active")} label="passes Google actives"/>
          <AdminMetric value={n("wallet_errors")} label="passes Wallet en erreur"/>
          <AdminMetric value={Number(payments?.issues ?? 0)} label="abonnements impayés / en retard"/>
        </div>

        <div className="grid grid-2">
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

          <section className="card" aria-labelledby="errors-title">
            <h3 id="errors-title">Erreurs par commerce · 7 j</h3>
            {errorRows.length === 0
              ? <div className="empty-state"><strong>Aucune erreur scanner ni Wallet.</strong><p>Les échecs scanner et caméra remontés par les téléphones, et les passes Wallet en erreur, apparaissent ici.</p></div>
              : <div className="table-wrap"><table>
                  <thead><tr><th>Commerce</th><th>Scans échoués 24 h</th><th>Scans échoués 7 j</th><th>Caméra 7 j</th><th>Wallet en erreur</th></tr></thead>
                  <tbody>{errorRows.map((row) => <tr key={String(row.id)}>
                    <td><Link href={`/admin/establishments/${row.id}`}>{String(row.name)}</Link></td>
                    <td>{Number(row.scan_failed_24h)}</td><td>{Number(row.scan_failed_7d)}</td><td>{Number(row.camera_failed_7d)}</td><td>{Number(row.wallet_errors)}</td>
                  </tr>)}</tbody>
                </table></div>}
            <p className="muted" style={{fontSize:13,marginBottom:0}}>Exceptions serveur et navigateur : Vercel Runtime Logs, clés <code>RETIKO_SERVER_ERROR</code> et <code>RETIKO_CLIENT_ERROR</code> (voir docs/OBSERVABILITY.md).</p>
          </section>
        </div>
      </section>

      <div className="grid grid-2" style={{marginBottom:18}}>
        <section className="card" aria-labelledby="volume-title">
          <h3 id="volume-title">Passages crédités · 30 jours</h3>
          {n("earn_30d") === 0 && <p className="muted">Aucun passage crédité sur 30 jours : la courbe se remplira au premier scan commerçant.</p>}
          <div className="table-wrap"><table>
            <thead><tr><th>Jour</th><th>Passages</th><th>Commerces</th><th aria-hidden="true"></th></tr></thead>
            <tbody>{daily.map((row) => <tr key={String(row.day)}>
              <td>{formatCalendarDate(row.day, { weekday: "short", day: "2-digit", month: "2-digit" })}</td>
              <td>{Number(row.earn)}</td>
              <td>{Number(row.establishments)}</td>
              <td style={{width:"40%"}}><AdminBar value={Number(row.earn)} max={maxDaily}/></td>
            </tr>)}</tbody>
          </table></div>
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
          {signups.length === 0 ? <p className="muted">Aucune inscription.</p> : <ul style={{margin:0,paddingLeft:18}}>
            {signups.map((row) => <li key={String(row.id)}><Link href={`/admin/establishments/${row.id}`}>{String(row.name)}</Link> <span className="muted">· {formatDate(row.created_at)}</span></li>)}
          </ul>}
        </section>
      </div>
    </main>
  </>;
}
