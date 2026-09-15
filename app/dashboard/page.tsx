import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { AppNav } from "@/components/app-nav";
import Link from "next/link";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const [restaurant] = await sql`select name, slug from establishments where id = ${session.establishmentId}`;
  const [program] = await sql`select mode, program_name, reward_threshold, reward_label from loyalty_programs where establishment_id = ${session.establishmentId}`;
  const [stats] = await sql`
    select
      (select count(*)::int from customers where establishment_id=${session.establishmentId} and deleted_at is null) customers,
      (select count(*)::int from cards where establishment_id=${session.establishmentId} and active=true) active_cards,
      (select coalesce(sum(case when delta>0 then delta else 0 end),0)::int from transactions where establishment_id=${session.establishmentId}) units_issued,
      (select count(*)::int from transactions where establishment_id=${session.establishmentId} and type='redeem') rewards_redeemed,
      (select count(distinct card_id)::int from transactions where establishment_id=${session.establishmentId} and created_at >= now()-interval '7 days') active_week
  `;
  const latest = await sql`
    select t.id,t.type,t.delta,t.balance_after,t.unit,t.created_at,c.short_code,u.first_name
    from transactions t join cards c on c.id=t.card_id join customers u on u.id=c.customer_id
    where t.establishment_id=${session.establishmentId} order by t.created_at desc limit 8
  `;
  return <><AppNav restaurantName={restaurant.name}/><main className="shell page">
    <div className="section-head"><div><span className="eyebrow">{program.mode === "STAMPS" ? "Tampons" : "Points"}</span><h2 style={{margin:"12px 0 4px"}}>{program.program_name}</h2><p className="muted">{program.reward_threshold} unités = {program.reward_label}</p></div><Link className="btn btn-primary" href="/s">Ouvrir le scanner</Link></div>
    <section className="grid grid-4">
      <div className="card metric"><strong>{stats.customers}</strong><span>clients inscrits</span></div>
      <div className="card metric"><strong>{stats.active_cards}</strong><span>cartes actives</span></div>
      <div className="card metric"><strong>{stats.units_issued}</strong><span>unités distribuées</span></div>
      <div className="card metric"><strong>{stats.rewards_redeemed}</strong><span>récompenses utilisées</span></div>
    </section>
    <section className="card" style={{marginTop:18}}><div className="section-head"><div><h3>Dernières transactions</h3><p className="muted">{stats.active_week} clients actifs sur 7 jours</p></div><Link className="btn" href="/dashboard/transactions">Tout voir</Link></div><div className="table-wrap"><table><thead><tr><th>Client</th><th>Action</th><th>Variation</th><th>Solde</th><th>Date</th></tr></thead><tbody>{latest.map((row)=><tr key={String(row.id)}><td>{row.first_name || row.short_code}</td><td>{row.type}</td><td>{Number(row.delta)>0?"+":""}{row.delta}</td><td>{row.balance_after}</td><td>{new Date(row.created_at).toLocaleString("fr-FR")}</td></tr>)}</tbody></table></div></section>
    <section className="grid grid-2" style={{marginTop:18}}><div className="card"><h3>QR d’inscription</h3><p className="muted">Lien public du commerce : <code>/j/{restaurant.slug}</code></p><Link className="btn" href="/dashboard/poster">Créer l’affiche A4</Link></div><div className="card"><h3>Wallet</h3><p className="muted">Apple Wallet et Google Wallet sont implémentés. Vérifie ici les credentials, passes émises et erreurs de synchronisation.</p><Link className="btn" href="/dashboard/wallet">Diagnostic Wallet</Link></div></section>
  </main></>;
}
