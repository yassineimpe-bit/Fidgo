import Link from "next/link";
import { AdminNav, Pager, formatDate } from "@/components/admin-nav";
import { sql } from "@/lib/db";
import { ADMIN_PAGE_SIZE, parseAdminSearch, requirePlatformAdmin } from "@/lib/platform-admin";

export const dynamic = "force-dynamic";

const STATUSES = ["trial", "active", "past_due", "unpaid", "canceled"] as const;
const STATUS_LABEL: Record<string, string> = {
  trial: "Essai", active: "Actif", past_due: "Paiement en retard", unpaid: "Impayé", canceled: "Annulé",
};

export default async function AdminSubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[]; page?: string | string[] }>;
}) {
  const params = await searchParams;
  const { page } = parseAdminSearch(params);
  const rawStatus = Array.isArray(params.status) ? params.status[0] : params.status;
  const status = STATUSES.find((value) => value === rawStatus) ?? "all";
  const admin = await requirePlatformAdmin("subscriptions", { status, page });

  const summary = await sql`
    select plan, status, count(*)::int as count from subscriptions group by plan, status order by plan, status
  `;
  const [attention] = await sql`
    select
      count(*) filter (where status='trial' and trial_ends_at between now() and now() + interval '7 days')::int as trials_ending,
      count(*) filter (where status='trial' and trial_ends_at < now())::int as trials_expired,
      count(*) filter (where cancel_at_period_end)::int as cancel_scheduled
    from subscriptions
  `;

  const [count] = await sql`select count(*)::int as total from subscriptions where ${status} = 'all' or status = ${status}`;
  const total = Number(count.total);
  const totalPages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const rows = await sql`
    select sub.plan, sub.status, sub.billing_interval, sub.trial_ends_at, sub.current_period_end,
      sub.cancel_at_period_end, (sub.external_subscription_id is not null) as stripe_linked, sub.updated_at,
      e.id as establishment_id, e.name as establishment, e.status as establishment_status
    from subscriptions sub join establishments e on e.id=sub.establishment_id
    where ${status} = 'all' or sub.status = ${status}
    order by sub.updated_at desc, sub.id
    limit ${ADMIN_PAGE_SIZE} offset ${(currentPage - 1) * ADMIN_PAGE_SIZE}
  `;

  const href = (target: number) => {
    const search = new URLSearchParams();
    if (status !== "all") search.set("status", status);
    if (target > 1) search.set("page", String(target));
    const query = search.toString();
    return query ? `/admin/subscriptions?${query}` : "/admin/subscriptions";
  };

  return <>
    <AdminNav email={admin.email}/>
    <main className="shell page">
      <div className="section-head"><div>
        <span className="eyebrow">Plateforme</span>
        <h2 style={{margin:"12px 0 4px"}}>Abonnements</h2>
        <p className="muted">Lecture seule. Aucune donnée de paiement ni identifiant Stripe n’est affiché ; la facturation se gère dans Stripe.</p>
      </div></div>

      <section className="grid grid-3" style={{marginBottom:18}}>
        <div className="card metric"><strong>{Number(attention.trials_ending)}</strong><span>essais finissant sous 7 j</span></div>
        <div className="card metric"><strong>{Number(attention.trials_expired)}</strong><span>essais expirés non convertis</span></div>
        <div className="card metric"><strong>{Number(attention.cancel_scheduled)}</strong><span>annulations programmées</span></div>
      </section>

      <section className="card" style={{marginBottom:18}}>
        <h3>Répartition</h3>
        <div className="table-wrap"><table>
          <thead><tr><th>Offre</th><th>Statut</th><th>Commerces</th></tr></thead>
          <tbody>{summary.map((row) => <tr key={`${row.plan}-${row.status}`}><td>{String(row.plan)}</td><td>{STATUS_LABEL[String(row.status)] || String(row.status)}</td><td>{Number(row.count)}</td></tr>)}</tbody>
        </table></div>
      </section>

      <section className="card">
        <nav className="actions" aria-label="Filtrer par statut" style={{marginTop:0}}>
          <Link className={`btn${status === "all" ? " btn-primary" : ""}`} href="/admin/subscriptions">Tous</Link>
          {STATUSES.map((value) => <Link key={value} className={`btn${status === value ? " btn-primary" : ""}`} href={`/admin/subscriptions?status=${value}`}>{STATUS_LABEL[value]}</Link>)}
        </nav>
        <div className="table-wrap"><table>
          <thead><tr><th>Commerce</th><th>Offre</th><th>Statut</th><th>Fin d’essai</th><th>Fin de période</th><th>Stripe</th><th>Mis à jour</th></tr></thead>
          <tbody>
            {rows.map((row) => <tr key={String(row.establishment_id)}>
              <td><Link href={`/admin/establishments/${row.establishment_id}`}>{String(row.establishment)}</Link>{row.establishment_status !== "active" ? <div className="muted">commerce suspendu</div> : null}</td>
              <td>{String(row.plan)}{row.billing_interval ? ` · ${String(row.billing_interval)}` : ""}</td>
              <td>{STATUS_LABEL[String(row.status)] || String(row.status)}{row.cancel_at_period_end ? <div className="muted">annulation programmée</div> : null}</td>
              <td>{formatDate(row.trial_ends_at)}</td>
              <td>{formatDate(row.current_period_end)}</td>
              <td>{row.stripe_linked ? "lié" : "—"}</td>
              <td>{formatDate(row.updated_at)}</td>
            </tr>)}
            {rows.length === 0 && <tr><td colSpan={7} className="muted">Aucun abonnement.</td></tr>}
          </tbody>
        </table></div>
      </section>
      <Pager page={currentPage} totalPages={totalPages} href={href}/>
    </main>
  </>;
}
