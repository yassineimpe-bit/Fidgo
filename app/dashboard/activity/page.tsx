import Link from "next/link";
import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { ACTIVITY_PERIODS, activityActionLabel, parseActivityFilters } from "@/lib/activity-log";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { canManageProgram } from "@/lib/loyalty";

type Row = {
  id: string;
  action: string;
  entity_type?: string | null;
  entity_id?: string | null;
  created_at: string;
  staff_email?: string | null;
  target_email?: string | null;
};

function href(filters: ReturnType<typeof parseActivityFilters>, page: number) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.period.value !== "30") params.set("period", filters.period.value);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/dashboard/activity?${query}` : "/dashboard/activity";
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; period?: string | string[]; page?: string | string[] }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!canManageProgram(session.role)) redirect("/dashboard");

  const filters = parseActivityFilters(await searchParams);
  const pattern = `%${filters.q.toLowerCase()}%`;
  const [restaurant] = await sql`select name from establishments where id=${session.establishmentId}`;

  const [countRow] = await sql`
    select count(*)::int as total
    from audit_logs a
    left join staff_users s on s.id=a.staff_user_id and s.establishment_id=a.establishment_id
    left join staff_users target on target.id::text=a.entity_id
      and a.entity_type='staff_user' and target.establishment_id=a.establishment_id
    where a.establishment_id=${session.establishmentId}
      and a.created_at >= now() - (${filters.period.days}::int * interval '1 day')
      and (
        ${filters.q} = ''
        or lower(a.action) like ${pattern}
        or lower(coalesce(a.entity_type,'')) like ${pattern}
        or lower(coalesce(s.email,'')) like ${pattern}
        or lower(coalesce(target.email,'')) like ${pattern}
      )
  `;
  const total = Number(countRow?.total || 0);
  const totalPages = Math.max(1, Math.ceil(total / filters.limit));
  const currentPage = Math.min(filters.page, totalPages);
  const offset = (currentPage - 1) * filters.limit;

  const raw = await sql`
    select a.id,a.action,a.entity_type,a.entity_id,a.created_at,
      s.email as staff_email,target.email as target_email
    from audit_logs a
    left join staff_users s on s.id=a.staff_user_id and s.establishment_id=a.establishment_id
    left join staff_users target on target.id::text=a.entity_id
      and a.entity_type='staff_user' and target.establishment_id=a.establishment_id
    where a.establishment_id=${session.establishmentId}
      and a.created_at >= now() - (${filters.period.days}::int * interval '1 day')
      and (
        ${filters.q} = ''
        or lower(a.action) like ${pattern}
        or lower(coalesce(a.entity_type,'')) like ${pattern}
        or lower(coalesce(s.email,'')) like ${pattern}
        or lower(coalesce(target.email,'')) like ${pattern}
      )
    order by a.created_at desc
    limit ${filters.limit}
    offset ${offset}
  `;

  const rows: Row[] = raw.map((row) => ({
    id: String(row.id),
    action: String(row.action),
    entity_type: row.entity_type ? String(row.entity_type) : null,
    entity_id: row.entity_id ? String(row.entity_id) : null,
    created_at: String(row.created_at),
    staff_email: row.staff_email ? String(row.staff_email) : null,
    target_email: row.target_email ? String(row.target_email) : null,
  }));

  return <>
    <AppNav restaurantName={String(restaurant?.name || "Retiko")}/>
    <main className="shell page">
      <div className="section-head">
        <div>
          <span className="eyebrow">Traçabilité</span>
          <h2 style={{margin:"12px 0 4px"}}>Journal d’activité</h2>
          <p className="muted">Actions sensibles du commerce, sans afficher les métadonnées techniques.</p>
        </div>
        <Link className="btn" href="/dashboard/analytics">Retour aux analytics</Link>
      </div>

      <section className="card" style={{marginBottom:18}}>
        <form method="get" className="grid grid-3" aria-label="Filtrer le journal d'activité">
          <div>
            <label htmlFor="activity-search">Action ou employé</label>
            <input className="input" id="activity-search" name="q" defaultValue={filters.q} placeholder="STAFF_CREATE ou email"/>
          </div>
          <div>
            <label htmlFor="activity-period">Période</label>
            <select className="input" id="activity-period" name="period" defaultValue={filters.period.value}>
              {ACTIVITY_PERIODS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </div>
          <div className="actions" style={{margin:0,alignItems:"end"}}>
            <button className="btn btn-primary" type="submit">Filtrer</button>
            <Link className="btn" href="/dashboard/activity">Réinitialiser</Link>
          </div>
        </form>
        <p className="muted" style={{marginBottom:0}}>{total} événement{total > 1 ? "s" : ""} · page {currentPage}/{totalPages}</p>
      </section>

      <section className="card">
        {rows.length === 0
          ? <div className="empty-state"><strong>Aucune activité sur cette période.</strong><p>Les actions sensibles apparaîtront ici.</p></div>
          : <div className="table-wrap"><table>
              <thead><tr><th>Date</th><th>Action</th><th>Employé</th><th>Cible</th></tr></thead>
              <tbody>{rows.map((row) => <tr key={row.id}>
                <td>{new Date(row.created_at).toLocaleString("fr-FR")}</td>
                <td><strong>{activityActionLabel(row.action)}</strong><div className="muted">{row.action}</div></td>
                <td>{row.staff_email || "système"}</td>
                <td>{row.target_email || row.entity_type || "—"}{row.entity_id && !row.target_email ? <div className="muted">{row.entity_id.slice(0, 12)}…</div> : null}</td>
              </tr>)}</tbody>
            </table></div>}
      </section>

      {totalPages > 1 && <nav className="actions" aria-label="Pagination du journal" style={{justifyContent:"space-between"}}>
        <div>{currentPage > 1 && <Link className="btn" href={href(filters,currentPage-1)}>← Précédent</Link>}</div>
        <span className="muted">Page {currentPage} sur {totalPages}</span>
        <div>{currentPage < totalPages && <Link className="btn" href={href(filters,currentPage+1)}>Suivant →</Link>}</div>
      </nav>}
    </main>
  </>;
}
