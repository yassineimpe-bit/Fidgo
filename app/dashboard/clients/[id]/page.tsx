import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { BalanceAdjustment } from "@/components/balance-adjustment";
import { CustomerContact } from "@/components/customer-contact";
import { CustomerNote } from "@/components/customer-note";
import { getSession } from "@/lib/auth";
import { CUSTOMER_HISTORY_PAGE_SIZE, customerHistoryHref, parseCustomerHistoryPage } from "@/lib/customer-detail";
import { sql } from "@/lib/db";
import { canAccessBackoffice, canManageCustomers, canManageProgram } from "@/lib/loyalty";
import { programUnits } from "@/lib/program-units";
import { transactionTypeLabel } from "@/lib/transaction-history";

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!canAccessBackoffice(session.role)) redirect("/s");
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  const requestedPage = parseCustomerHistoryPage((await searchParams).page);

  const [restaurant] = await sql`
    select e.name, p.mode,
      to_jsonb(p)->>'unit_label' as unit_label, to_jsonb(p)->>'unit_label_plural' as unit_label_plural
    from establishments e
    left join loyalty_programs p on p.establishment_id=e.id
    where e.id=${session.establishmentId}
  `;
  const units = programUnits(String(restaurant?.mode || "STAMPS"), restaurant?.unit_label, restaurant?.unit_label_plural);
  const [customer] = await sql`
    select
      u.id,u.first_name,u.email,u.phone,u.internal_note,u.marketing_consent,u.created_at,
      c.id as card_id,c.short_code,c.balance,c.active,c.created_at as card_created_at
    from customers u
    left join cards c on c.customer_id=u.id and c.establishment_id=u.establishment_id
    where u.id=${id}
      and u.establishment_id=${session.establishmentId}
      and u.deleted_at is null
    limit 1
  `;
  if (!customer) notFound();

  const [stats] = await sql`
    select
      count(*)::int as count,
      count(*) filter (where t.type='earn' and reversal.id is null)::int as earns,
      count(*) filter (where t.type='redeem' and reversal.id is null)::int as redeems,
      count(distinct (t.created_at at time zone 'Europe/Paris')::date)
        filter (where t.type='earn' and reversal.id is null)::int as visit_days,
      coalesce(sum(t.delta) filter (where t.type='earn' and reversal.id is null),0)::int as units_earned,
      min(t.created_at) filter (where t.type='earn' and reversal.id is null) as first_visit,
      max(t.created_at) filter (where t.type='earn' and reversal.id is null) as last_visit,
      max(t.created_at) as last_transaction
    from transactions t
    left join transactions reversal on reversal.reversed_transaction_id=t.id
      and reversal.establishment_id=t.establishment_id and reversal.type='reversal'
    where t.establishment_id=${session.establishmentId}
      and t.card_id=${customer.card_id}
  `;
  const count = Number(stats?.count || 0);
  const totalPages = Math.max(1, Math.ceil(count / CUSTOMER_HISTORY_PAGE_SIZE));
  const currentPage = Math.min(requestedPage, totalPages);
  const offset = (currentPage - 1) * CUSTOMER_HISTORY_PAGE_SIZE;

  const transactions = await sql`
    select
      t.id,t.type,t.delta,t.balance_after,t.unit,t.created_at,
      case when t.type='adjust' then t.metadata->>'reason' end as adjust_reason,
      st.email as staff_email,
      exists(select 1 from transactions r where r.reversed_transaction_id=t.id
        and r.establishment_id=t.establishment_id) as reversed
    from transactions t
    left join staff_users st on st.id=t.staff_user_id and st.establishment_id=t.establishment_id
    where t.establishment_id=${session.establishmentId}
      and t.card_id=${customer.card_id}
    order by t.created_at desc,t.id desc
    limit ${CUSTOMER_HISTORY_PAGE_SIZE}
    offset ${offset}
  `;
  const formatDate = (value: unknown) => value ? new Date(String(value)).toLocaleString("fr-FR") : "Aucune";

  return <>
    <AppNav restaurantName={String(restaurant?.name || "Retiko")}/>
    <main className="shell page">
      <div className="section-head">
        <div>
          <span className="eyebrow">Client</span>
          <h2 style={{margin:"12px 0 4px"}}>{customer.first_name || "Sans prénom"}</h2>
          <p className="muted">Carte {customer.short_code || "sans code court"}</p>
        </div>
        <div className="actions">
          <Link className="btn" href="/dashboard/clients">← Clients</Link>
          {customer.active && <Link className="btn btn-primary" href="/s">Ouvrir le scanner · {customer.short_code}</Link>}
          {canManageProgram(session.role) && <a className="btn" href={`/api/customers/${customer.id}/export`}>Exporter RGPD</a>}
        </div>
      </div>

      <section className="grid grid-4">
        <div className="card metric"><strong>{customer.balance ?? 0}</strong><span>solde actuel</span></div>
        <div className="card metric"><strong>{stats?.visit_days ?? 0}</strong><span>jours de visite crédités</span></div>
        <div className="card metric"><strong>{stats?.units_earned ?? 0}</strong><span>unités créditées non annulées</span></div>
        <div className="card metric"><strong>{stats?.redeems ?? 0}</strong><span>récompenses consommées</span></div>
      </section>

      <section className="card" style={{marginTop:18}}>
        <h3>Activité</h3>
        <dl className="grid grid-3">
          <div><dt>Première visite créditée</dt><dd>{formatDate(stats?.first_visit)}</dd></div>
          <div><dt>Dernière visite créditée</dt><dd>{formatDate(stats?.last_visit)}</dd></div>
          <div><dt>Dernière transaction</dt><dd>{formatDate(stats?.last_transaction)}</dd></div>
        </dl>
        <p className="muted" style={{marginBottom:0}}>Une visite correspond ici à un jour avec au moins un crédit non annulé. Les transactions restent détaillées ci-dessous.</p>
      </section>

      <CustomerNote customerId={id} initialNote={String(customer.internal_note || "")} canEdit={canManageProgram(session.role)} />

      <section className="grid grid-2" style={{marginTop:18}}>
        <CustomerContact customerId={id} canEdit={canManageCustomers(session.role)} initial={{
          firstName: String(customer.first_name || ""),
          email: String(customer.email || ""),
          phone: String(customer.phone || ""),
          marketingConsent: customer.marketing_consent === true,
        }} />
        <div className="card">
          <h3>Carte</h3>
          <dl>
            <dt>Client inscrit le</dt><dd>{new Date(String(customer.created_at)).toLocaleString("fr-FR")}</dd>
            <dt>Code court</dt><dd>{customer.short_code || "—"}</dd>
            <dt>État</dt><dd>{customer.active ? "Active" : "Inactive"}</dd>
            <dt>Créée le</dt><dd>{customer.card_created_at ? new Date(String(customer.card_created_at)).toLocaleString("fr-FR") : "—"}</dd>
          </dl>
        </div>
      </section>

      <section className="card" style={{marginTop:18}}>
        <div className="section-head"><div><h3>Historique des transactions</h3><p className="muted">{count} écriture{count > 1 ? "s" : ""} · page {currentPage}/{totalPages} · 50 par page.</p></div></div>
        {canManageCustomers(session.role) && customer.card_id && customer.active && <BalanceAdjustment
          customerId={id}
          customerName={String(customer.first_name || "Sans prénom")}
          balance={Number(customer.balance ?? 0)}
          units={units}
        />}
        {transactions.length === 0
          ? <div className="empty-state"><strong>Aucune transaction.</strong><p>Le premier passage apparaîtra ici.</p></div>
          : <div className="table-wrap table-cards"><table role="table">
              <thead role="rowgroup"><tr role="row"><th role="columnheader">Date</th><th role="columnheader">Type</th><th role="columnheader">Variation</th><th role="columnheader">Solde après</th><th role="columnheader">Employé</th></tr></thead>
              <tbody role="rowgroup">{transactions.map((row) => <tr role="row" key={String(row.id)}>
                <td role="cell" className="cell-title">{new Date(String(row.created_at)).toLocaleString("fr-FR")}</td>
                <td role="cell" data-label="Type"><div>{transactionTypeLabel(String(row.type))}{row.reversed ? " · annulée" : ""}
                  {row.adjust_reason && <div className="muted" style={{fontSize:13}}>Motif : {String(row.adjust_reason)}</div>}</div></td>
                <td role="cell" data-label="Variation">{Number(row.delta) > 0 ? "+" : ""}{Number(row.delta)}</td>
                <td role="cell" data-label="Solde après">{Number(row.balance_after)}</td>
                <td role="cell" data-label="Employé">{row.staff_email ? String(row.staff_email) : "système"}</td>
              </tr>)}</tbody>
            </table></div>}
      </section>
      {totalPages > 1 && <nav className="actions" aria-label="Pagination de l’historique client" style={{justifyContent:"space-between"}}>
        <div>{currentPage > 1 && <Link className="btn" href={customerHistoryHref(id,currentPage-1)}>← Précédent</Link>}</div>
        <span className="muted">Page {currentPage} sur {totalPages}</span>
        <div>{currentPage < totalPages && <Link className="btn" href={customerHistoryHref(id,currentPage+1)}>Suivant →</Link>}</div>
      </nav>}
    </main>
  </>;
}
