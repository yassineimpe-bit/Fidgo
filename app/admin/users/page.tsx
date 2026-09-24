import Link from "next/link";
import { AdminNav, Pager, formatDate } from "@/components/admin-nav";
import { sql } from "@/lib/db";
import { staffRoleLabel, type StaffRole } from "@/lib/loyalty";
import { ADMIN_PAGE_SIZE, likePattern, parseAdminSearch, requirePlatformAdmin } from "@/lib/platform-admin";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; page?: string | string[] }>;
}) {
  const { q, page } = parseAdminSearch(await searchParams);
  const admin = await requirePlatformAdmin("users", { query: Boolean(q), page });
  const pattern = likePattern(q);

  const [count] = await sql`
    select count(*)::int as total
    from staff_users s join establishments e on e.id=s.establishment_id
    where ${q} = '' or lower(s.email) like ${pattern} or lower(e.name) like ${pattern} or lower(e.slug) like ${pattern}
  `;
  const total = Number(count.total);
  const totalPages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);

  const rows = await sql`
    select s.id, s.email, s.role, s.active, s.created_at,
      e.id as establishment_id, e.name as establishment, e.status as establishment_status,
      (pa.staff_user_id is not null) as platform_admin
    from staff_users s
    join establishments e on e.id=s.establishment_id
    left join platform_admins pa on pa.staff_user_id=s.id
    where ${q} = '' or lower(s.email) like ${pattern} or lower(e.name) like ${pattern} or lower(e.slug) like ${pattern}
    order by s.created_at desc, s.id
    limit ${ADMIN_PAGE_SIZE} offset ${(currentPage - 1) * ADMIN_PAGE_SIZE}
  `;

  const href = (target: number) => {
    const search = new URLSearchParams();
    if (q) search.set("q", q);
    if (target > 1) search.set("page", String(target));
    const query = search.toString();
    return query ? `/admin/users?${query}` : "/admin/users";
  };

  return <>
    <AdminNav email={admin.email}/>
    <main className="shell page">
      <div className="section-head"><div>
        <span className="eyebrow">Plateforme</span>
        <h2 style={{margin:"12px 0 4px"}}>Utilisateurs</h2>
        <p className="muted">Comptes staff (propriétaires, managers, employés). Les clients finaux ne sont pas listés ici. {total} compte{total > 1 ? "s" : ""}.</p>
      </div></div>

      <section className="card" style={{marginBottom:18}}>
        <form method="get" className="grid grid-3" role="search" aria-label="Rechercher un utilisateur">
          <div>
            <label htmlFor="admin-user-search">Recherche</label>
            <input className="input" id="admin-user-search" name="q" defaultValue={q} maxLength={120} placeholder="Email ou commerce"/>
          </div>
          <div className="actions" style={{margin:0,alignItems:"end"}}>
            <button className="btn btn-primary" type="submit">Rechercher</button>
            <Link className="btn" href="/admin/users">Réinitialiser</Link>
          </div>
        </form>
      </section>

      <section className="card">
        {rows.length === 0
          ? <div className="empty-state"><strong>Aucun utilisateur trouvé.</strong></div>
          : <div className="table-wrap"><table>
              <thead><tr><th>Email</th><th>Rôle</th><th>Commerce</th><th>Compte</th><th>Créé le</th></tr></thead>
              <tbody>{rows.map((row) => <tr key={String(row.id)}>
                <td>{String(row.email)}{row.platform_admin ? <span className="badge" style={{marginLeft:8}}>super-admin</span> : null}</td>
                <td>{staffRoleLabel(String(row.role) as StaffRole)}</td>
                <td><Link href={`/admin/establishments/${row.establishment_id}`}>{String(row.establishment)}</Link>{row.establishment_status !== "active" ? <div className="muted">commerce suspendu</div> : null}</td>
                <td>{row.active ? "Actif" : "Désactivé"}</td>
                <td>{formatDate(row.created_at)}</td>
              </tr>)}</tbody>
            </table></div>}
      </section>
      <Pager page={currentPage} totalPages={totalPages} href={href}/>
    </main>
  </>;
}
