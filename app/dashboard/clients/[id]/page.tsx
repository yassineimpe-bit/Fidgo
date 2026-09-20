import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { transactionTypeLabel } from "@/lib/transaction-history";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { id } = await params;

  const [restaurant] = await sql`
    select name from establishments where id=${session.establishmentId}
  `;
  const [customer] = await sql`
    select
      u.id,u.first_name,u.email,u.phone,u.marketing_consent,u.created_at,
      c.id as card_id,c.short_code,c.balance,c.active,c.created_at as card_created_at
    from customers u
    left join cards c on c.customer_id=u.id and c.establishment_id=u.establishment_id
    where u.id=${id}
      and u.establishment_id=${session.establishmentId}
      and u.deleted_at is null
    limit 1
  `;
  if (!customer) notFound();

  const transactions = await sql`
    select
      t.id,t.type,t.delta,t.balance_after,t.unit,t.created_at,
      st.email as staff_email,
      exists(select 1 from transactions r where r.reversed_transaction_id=t.id) as reversed
    from transactions t
    left join staff_users st on st.id=t.staff_user_id
    where t.establishment_id=${session.establishmentId}
      and t.card_id=${customer.card_id}
    order by t.created_at desc
    limit 50
  `;

  const total = await sql`
    select
      count(*)::int as count,
      count(*) filter (where type='earn')::int as earns,
      count(*) filter (where type='redeem')::int as redeems
    from transactions
    where establishment_id=${session.establishmentId}
      and card_id=${customer.card_id}
  `;
  const stats = total[0] || { count: 0, earns: 0, redeems: 0 };

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
          <a className="btn" href={`/api/customers/${customer.id}/export`}>Exporter RGPD</a>
        </div>
      </div>

      <section className="grid grid-4">
        <div className="card metric"><strong>{customer.balance ?? 0}</strong><span>solde actuel</span></div>
        <div className="card metric"><strong>{stats.count}</strong><span>transactions</span></div>
        <div className="card metric"><strong>{stats.earns}</strong><span>crédits</span></div>
        <div className="card metric"><strong>{stats.redeems}</strong><span>récompenses</span></div>
      </section>

      <section className="grid grid-2" style={{marginTop:18}}>
        <div className="card">
          <h3>Profil</h3>
          <dl>
            <dt>Email</dt><dd>{customer.email || "Non fourni"}</dd>
            <dt>Téléphone</dt><dd>{customer.phone || "Non fourni"}</dd>
            <dt>Marketing</dt><dd>{customer.marketing_consent ? "Consentement actif" : "Non consenti"}</dd>
            <dt>Inscrit le</dt><dd>{new Date(String(customer.created_at)).toLocaleString("fr-FR")}</dd>
          </dl>
        </div>
        <div className="card">
          <h3>Carte</h3>
          <dl>
            <dt>Code court</dt><dd>{customer.short_code || "—"}</dd>
            <dt>État</dt><dd>{customer.active ? "Active" : "Inactive"}</dd>
            <dt>Créée le</dt><dd>{customer.card_created_at ? new Date(String(customer.card_created_at)).toLocaleString("fr-FR") : "—"}</dd>
          </dl>
        </div>
      </section>

      <section className="card" style={{marginTop:18}}>
        <div className="section-head"><div><h3>Historique récent</h3><p className="muted">50 dernières écritures du ledger de cette carte.</p></div></div>
        {transactions.length === 0
          ? <div className="empty-state"><strong>Aucune transaction.</strong><p>Le premier passage apparaîtra ici.</p></div>
          : <div className="table-wrap"><table>
              <thead><tr><th>Date</th><th>Type</th><th>Variation</th><th>Solde après</th><th>Employé</th></tr></thead>
              <tbody>{transactions.map((row) => <tr key={String(row.id)}>
                <td>{new Date(String(row.created_at)).toLocaleString("fr-FR")}</td>
                <td>{transactionTypeLabel(String(row.type))}{row.reversed ? " · annulée" : ""}</td>
                <td>{Number(row.delta) > 0 ? "+" : ""}{Number(row.delta)}</td>
                <td>{Number(row.balance_after)}</td>
                <td>{row.staff_email ? String(row.staff_email) : "système"}</td>
              </tr>)}</tbody>
            </table></div>}
      </section>
    </main>
  </>;
}
