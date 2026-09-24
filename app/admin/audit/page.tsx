import Link from "next/link";
import { AdminNav, Pager, formatDate } from "@/components/admin-nav";
import { sql } from "@/lib/db";
import { ADMIN_PAGE_SIZE, parseAdminSearch, requirePlatformAdmin } from "@/lib/platform-admin";

export const dynamic = "force-dynamic";

const ACTION_LABEL: Record<string, string> = {
  ADMIN_VIEW: "Consultation",
  PLATFORM_SUSPEND: "Suspension commerce",
  PLATFORM_REACTIVATE: "Réactivation commerce",
  PLATFORM_ADMIN_GRANT: "Droits super-admin accordés",
  PLATFORM_ADMIN_REVOKE: "Droits super-admin retirés",
};

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[]; views?: string | string[] }>;
}) {
  const params = await searchParams;
  const { page } = parseAdminSearch(params);
  const includeViews = (Array.isArray(params.views) ? params.views[0] : params.views) === "1";
  const admin = await requirePlatformAdmin("audit", { includeViews, page });

  const [count] = await sql`
    select count(*)::int as total from platform_admin_audit where ${includeViews} or action <> 'ADMIN_VIEW'
  `;
  const total = Number(count.total);
  const totalPages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const rows = await sql`
    select a.id, a.admin_email, a.action, a.target_type, a.target_id, a.reason, a.metadata, a.created_at,
      e.name as establishment
    from platform_admin_audit a
    left join establishments e on a.target_type='establishment' and e.id::text=a.target_id
    where ${includeViews} or a.action <> 'ADMIN_VIEW'
    order by a.created_at desc, a.id
    limit ${ADMIN_PAGE_SIZE} offset ${(currentPage - 1) * ADMIN_PAGE_SIZE}
  `;

  const href = (target: number) => {
    const search = new URLSearchParams();
    if (includeViews) search.set("views", "1");
    if (target > 1) search.set("page", String(target));
    const query = search.toString();
    return query ? `/admin/audit?${query}` : "/admin/audit";
  };

  return <>
    <AdminNav email={admin.email}/>
    <main className="shell page">
      <div className="section-head"><div>
        <span className="eyebrow">Traçabilité</span>
        <h2 style={{margin:"12px 0 4px"}}>Journal super-admin</h2>
        <p className="muted">Append-only : aucune entrée ne peut être modifiée ni supprimée, y compris en SQL direct.</p>
      </div>
        <Link className="btn" href={includeViews ? "/admin/audit" : "/admin/audit?views=1"}>{includeViews ? "Masquer les consultations" : "Inclure les consultations"}</Link>
      </div>

      <section className="card">
        <div className="table-wrap"><table>
          <thead><tr><th>Date</th><th>Admin</th><th>Action</th><th>Cible</th><th>Motif / détail</th></tr></thead>
          <tbody>
            {rows.map((row) => {
              const metadata = (row.metadata || {}) as Record<string, unknown>;
              return <tr key={String(row.id)}>
                <td>{formatDate(row.created_at)}</td>
                <td>{String(row.admin_email || "cli")}</td>
                <td>{ACTION_LABEL[String(row.action)] || String(row.action)}</td>
                <td>{row.target_type === "establishment" && row.target_id
                  ? <Link href={`/admin/establishments/${row.target_id}`}>{String(row.establishment || row.target_id)}</Link>
                  : row.target_type ? `${String(row.target_type)} ${String(row.target_id || "").slice(0, 8)}` : "—"}</td>
                <td>{row.reason ? String(row.reason) : typeof metadata.view === "string" ? `page ${metadata.view}` : "—"}</td>
              </tr>;
            })}
            {rows.length === 0 && <tr><td colSpan={5} className="muted">Aucune entrée.</td></tr>}
          </tbody>
        </table></div>
      </section>
      <Pager page={currentPage} totalPages={totalPages} href={href}/>
    </main>
  </>;
}
