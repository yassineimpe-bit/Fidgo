import Link from "next/link";
import { AdminNav, Pager, StatusBadge, formatDate } from "@/components/admin-nav";
import { sql } from "@/lib/db";
import { ADMIN_PAGE_SIZE, likePattern, parseAdminSearch, requirePlatformAdmin } from "@/lib/platform-admin";
import {
  ACTIVITY_FILTERS, ACTIVITY_FILTER_LABELS, SORTS, SORT_LABELS, SUBSCRIPTION_FILTERS, SUBSCRIPTION_FILTER_LABELS,
  WATCH_ANY, WATCH_REASON_LABELS, activityCondition, establishmentUsage, formatMs, formatPercent, parseEstablishmentFilters,
  ratePercent, scanErrorRate, sortClause, subscriptionCondition, watchReasons,
} from "@/lib/platform-metrics";

export const dynamic = "force-dynamic";

type SearchParams = {
  q?: string | string[]; page?: string | string[]; status?: string | string[];
  activity?: string | string[]; subscription?: string | string[]; watch?: string | string[]; sort?: string | string[];
};

export default async function AdminEstablishmentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const { q, page } = parseAdminSearch(params);
  const filters = parseEstablishmentFilters(params);
  const { status, activity, subscription, watch, sort } = filters;
  const admin = await requirePlatformAdmin("establishments", { query: Boolean(q), status, activity, subscription, watch, sort, page });
  const pattern = likePattern(q);

  // Recherche et statut restreignent le périmètre avant tout calcul ; activité,
  // abonnement et « à surveiller » filtrent les indicateurs calculés.
  const scope = sql`
    (${status} = 'all' or e.status = ${status})
    and (
      ${q} = ''
      or lower(e.name) like ${pattern}
      or lower(e.slug) like ${pattern}
      or lower(coalesce(o.email,'')) like ${pattern}
    )
  `;
  const where = sql`${activityCondition(activity)} and ${subscriptionCondition(subscription)} and ${watch ? WATCH_ANY : sql`true`}`;

  const [count] = await sql`select count(*)::int as total from (${establishmentUsage(scope)}) u where ${where}`;
  const total = Number(count.total);
  const totalPages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);

  const rows = await sql`
    select u.* from (${establishmentUsage(scope)}) u
    where ${where}
    order by ${sortClause(sort)}
    limit ${ADMIN_PAGE_SIZE} offset ${(currentPage - 1) * ADMIN_PAGE_SIZE}
  `;
  const now = new Date();

  const href = (target: number) => {
    const search = new URLSearchParams();
    if (q) search.set("q", q);
    if (status !== "all") search.set("status", status);
    if (activity !== "all") search.set("activity", activity);
    if (subscription !== "all") search.set("subscription", subscription);
    if (watch) search.set("watch", "1");
    if (sort !== "created") search.set("sort", sort);
    if (target > 1) search.set("page", String(target));
    const query = search.toString();
    return query ? `/admin/establishments?${query}` : "/admin/establishments";
  };
  const filtered = Boolean(q) || status !== "all" || activity !== "all" || subscription !== "all" || watch;

  return <>
    <AdminNav email={admin.email}/>
    <main className="shell page admin-cockpit">
      <div className="section-head"><div>
        <span className="eyebrow">Plateforme</span>
        <h2 style={{margin:"12px 0 4px"}}>Commerces</h2>
        <p className="muted">{total} commerce{total > 1 ? "s" : ""} · page {currentPage}/{totalPages} · passages = passages crédités (<code>earn</code>), clients sur 30 j, scanner sur 7 j.</p>
      </div></div>

      <section className="card" style={{marginBottom:18}}>
        <form method="get" className="admin-filters" role="search" aria-label="Rechercher un commerce">
          <div>
            <label htmlFor="admin-establishment-search">Recherche</label>
            <input className="input" id="admin-establishment-search" name="q" defaultValue={q} maxLength={120} placeholder="Nom, slug ou email propriétaire"/>
          </div>
          <div>
            <label htmlFor="admin-establishment-status">Statut</label>
            <select className="input" id="admin-establishment-status" name="status" defaultValue={status}>
              <option value="all">Tous</option>
              <option value="active">Actifs</option>
              <option value="suspended">Suspendus / fermés</option>
            </select>
          </div>
          <div>
            <label htmlFor="admin-establishment-activity">Activité</label>
            <select className="input" id="admin-establishment-activity" name="activity" defaultValue={activity}>
              {ACTIVITY_FILTERS.map((value) => <option key={value} value={value}>{ACTIVITY_FILTER_LABELS[value]}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="admin-establishment-subscription">Abonnement</label>
            <select className="input" id="admin-establishment-subscription" name="subscription" defaultValue={subscription}>
              {SUBSCRIPTION_FILTERS.map((value) => <option key={value} value={value}>{SUBSCRIPTION_FILTER_LABELS[value]}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="admin-establishment-sort">Tri</label>
            <select className="input" id="admin-establishment-sort" name="sort" defaultValue={sort}>
              {SORTS.map((value) => <option key={value} value={value}>{SORT_LABELS[value]}</option>)}
            </select>
          </div>
          <div>
            <label className="check" htmlFor="admin-establishment-watch" style={{display:"flex",gap:8,alignItems:"center",minHeight:44}}>
              <input type="checkbox" id="admin-establishment-watch" name="watch" value="1" defaultChecked={watch}/>
              À surveiller uniquement
            </label>
          </div>
          <div className="actions" style={{margin:0}}>
            <button className="btn btn-primary" type="submit">Rechercher</button>
            <Link className="btn" href="/admin/establishments">Réinitialiser</Link>
          </div>
        </form>
      </section>

      <section className="card">
        {rows.length === 0
          ? <div className="empty-state">
              <strong>Aucun commerce trouvé.</strong>
              <p>{filtered ? "Aucun commerce ne correspond à ces filtres." : "Aucun commerce inscrit pour l’instant."}</p>
            </div>
          : <div className="table-wrap"><table>
              <thead><tr>
                <th>Commerce</th><th>Statut · abonnement</th><th>Inscrit · 1er passage</th><th>Dernier passage</th>
                <th>Passages 7 j / 30 j</th><th>Clients 30 j</th><th>Récomp. 30 j</th><th>Wallet</th><th>Scanner 7 j</th>
              </tr></thead>
              <tbody>{rows.map((row) => {
                const reasons = watchReasons(row);
                const active = Number(row.active_customers_30d);
                const returning = Number(row.returning_customers_30d);
                const success = Number(row.scan_success_7d);
                const failed = Number(row.scan_failed_7d);
                return <tr key={String(row.id)}>
                  <td>
                    <Link href={`/admin/establishments/${row.id}`}><strong>{String(row.name)}</strong></Link>
                    <div className="muted">{String(row.slug)}{row.owner_email ? ` · ${String(row.owner_email)}` : ""}</div>
                    {reasons.length > 0 && <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:4}}>
                      {reasons.map((reason) => <span key={reason} className="badge warning">{WATCH_REASON_LABELS[reason]}</span>)}
                    </div>}
                  </td>
                  <td><div className="admin-usage-cell">
                    <StatusBadge status={String(row.status)} platform={Boolean(row.platform_suspended_at)}/>
                    <span className="muted">{row.plan ? `${String(row.plan)} · ${SUBSCRIPTION_FILTER_LABELS[String(row.subscription_status) as keyof typeof SUBSCRIPTION_FILTER_LABELS] ?? String(row.subscription_status)}` : "Sans abonnement"}</span>
                  </div></td>
                  <td><div className="admin-usage-cell">
                    <span>{formatDate(row.created_at)}</span>
                    <span className="muted">{row.first_earn_at ? formatDate(row.first_earn_at) : "Jamais démarré"}</span>
                  </div></td>
                  <td>{row.last_earn_at ? formatDate(row.last_earn_at) : "—"}</td>
                  <td className="admin-usage-cell">{Number(row.earn_7d)} / {Number(row.earn_30d)}</td>
                  <td><div className="admin-usage-cell">
                    <span>{active} actif{active > 1 ? "s" : ""}</span>
                    <span className="muted">{returning} revenu{returning > 1 ? "s" : ""} · {formatPercent(ratePercent(returning, active))}</span>
                  </div></td>
                  <td>{Number(row.rewards_30d)}</td>
                  <td><div className="admin-usage-cell">
                    <span>Apple {Number(row.wallet_apple_active)}</span>
                    <span>Google {Number(row.wallet_google_active)}</span>
                    {Number(row.wallet_errors) > 0 && <span className="badge warning">{Number(row.wallet_errors)} en erreur</span>}
                  </div></td>
                  <td><div className="admin-usage-cell">
                    <span>{formatPercent(scanErrorRate(success, failed))} d’échec</span>
                    <span className="muted">{success + failed} tent. · p95 {formatMs(row.scan_p95_7d)}</span>
                  </div></td>
                </tr>;
              })}</tbody>
            </table></div>}
        <p className="muted" style={{fontSize:12,marginBottom:0}}>Données au {now.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" })}.</p>
      </section>
      <Pager page={currentPage} totalPages={totalPages} href={href}/>
    </main>
  </>;
}
