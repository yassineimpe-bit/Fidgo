import Link from "next/link";
import { AdminNav, Pager, StatusBadge, formatDate } from "@/components/admin-nav";
import { sql } from "@/lib/db";
import { ADMIN_PAGE_SIZE, likePattern, parseAdminSearch, requirePlatformAdmin } from "@/lib/platform-admin";

export const dynamic = "force-dynamic";

const STATUS_FILTERS = ["all", "active", "suspended"] as const;

export default async function AdminEstablishmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; page?: string | string[]; status?: string | string[] }>;
}) {
  const params = await searchParams;
  const { q, page } = parseAdminSearch(params);
  const rawStatus = Array.isArray(params.status) ? params.status[0] : params.status;
  const status = STATUS_FILTERS.find((value) => value === rawStatus) ?? "all";
  const admin = await requirePlatformAdmin("establishments", { query: Boolean(q), status, page });
  const pattern = likePattern(q);

  const [count] = await sql`
    select count(*)::int as total
    from establishments e
    left join staff_users o on o.establishment_id=e.id and o.role='OWNER'
    where (${status} = 'all' or e.status = ${status})
      and (
        ${q} = ''
        or lower(e.name) like ${pattern}
        or lower(e.slug) like ${pattern}
        or lower(coalesce(o.email,'')) like ${pattern}
      )
  `;
  const total = Number(count.total);
  const totalPages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);

  const rows = await sql`
    select e.id, e.name, e.slug, e.status, e.platform_suspended_at, e.created_at,
      o.email as owner_email,
      sub.plan, sub.status as subscription_status,
      (select count(*)::int from customers c where c.establishment_id=e.id and c.deleted_at is null) as customers,
      (select count(*)::int from transactions t where t.establishment_id=e.id and t.type='earn' and t.created_at >= now() - interval '30 days') as scans_30d,
      (select max(t.created_at) from transactions t where t.establishment_id=e.id) as last_activity
    from establishments e
    left join staff_users o on o.establishment_id=e.id and o.role='OWNER'
    left join subscriptions sub on sub.establishment_id=e.id
    where (${status} = 'all' or e.status = ${status})
      and (
        ${q} = ''
        or lower(e.name) like ${pattern}
        or lower(e.slug) like ${pattern}
        or lower(coalesce(o.email,'')) like ${pattern}
      )
    order by e.created_at desc, e.id
    limit ${ADMIN_PAGE_SIZE} offset ${(currentPage - 1) * ADMIN_PAGE_SIZE}
  `;

  const href = (target: number) => {
    const search = new URLSearchParams();
    if (q) search.set("q", q);
    if (status !== "all") search.set("status", status);
    if (target > 1) search.set("page", String(target));
    const query = search.toString();
    return query ? `/admin/establishments?${query}` : "/admin/establishments";
  };

  return <>
    <AdminNav email={admin.email}/>
    <main className="shell page">
      <div className="section-head"><div>
        <span className="eyebrow">Plateforme</span>
        <h2 style={{margin:"12px 0 4px"}}>Commerces</h2>
        <p className="muted">{total} commerce{total > 1 ? "s" : ""} · page {currentPage}/{totalPages}</p>
      </div></div>

      <section className="card" style={{marginBottom:18}}>
        <form method="get" className="grid grid-3" role="search" aria-label="Rechercher un commerce">
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
          <div className="actions" style={{margin:0,alignItems:"end"}}>
            <button className="btn btn-primary" type="submit">Rechercher</button>
            <Link className="btn" href="/admin/establishments">Réinitialiser</Link>
          </div>
        </form>
      </section>

      <section className="card">
        {rows.length === 0
          ? <div className="empty-state"><strong>Aucun commerce trouvé.</strong></div>
          : <div className="table-wrap"><table>
              <thead><tr><th>Commerce</th><th>Statut</th><th>Propriétaire</th><th>Abonnement</th><th>Clients</th><th>Scans 30 j</th><th>Dernière activité</th><th>Inscrit le</th></tr></thead>
              <tbody>{rows.map((row) => <tr key={String(row.id)}>
                <td><Link href={`/admin/establishments/${row.id}`}><strong>{String(row.name)}</strong></Link><div className="muted">{String(row.slug)}</div></td>
                <td><StatusBadge status={String(row.status)} platform={Boolean(row.platform_suspended_at)}/></td>
                <td>{row.owner_email ? String(row.owner_email) : "—"}</td>
                <td>{row.plan ? `${String(row.plan)} · ${String(row.subscription_status)}` : "—"}</td>
                <td>{Number(row.customers)}</td>
                <td>{Number(row.scans_30d)}</td>
                <td>{formatDate(row.last_activity)}</td>
                <td>{formatDate(row.created_at)}</td>
              </tr>)}</tbody>
            </table></div>}
      </section>
      <Pager page={currentPage} totalPages={totalPages} href={href}/>
    </main>
  </>;
}
