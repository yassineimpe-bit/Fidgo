import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { AppNav } from "@/components/app-nav";
import { PwaInstallHint } from "@/components/pwa-install-hint";
import Link from "next/link";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const [restaurant] = await sql`select name, slug, logo_url from establishments where id = ${session.establishmentId}`;
  const [program] = await sql`select mode, program_name, reward_threshold, reward_label from loyalty_programs where establishment_id = ${session.establishmentId}`;
  const [stats] = await sql`
    select
      (select count(*)::int from customers where establishment_id=${session.establishmentId} and deleted_at is null) customers,
      (select count(*)::int from cards where establishment_id=${session.establishmentId} and active=true) active_cards,
      (select coalesce(sum(case when delta>0 then delta else 0 end),0)::int from transactions where establishment_id=${session.establishmentId}) units_issued,
      (select count(*)::int from transactions where establishment_id=${session.establishmentId} and type='redeem') rewards_redeemed,
      (select count(distinct card_id)::int from transactions where establishment_id=${session.establishmentId} and created_at >= now()-interval '7 days') active_week,
      (select count(*)::int from transactions where establishment_id=${session.establishmentId}) transactions,
      (select count(*)::int from product_events where establishment_id=${session.establishmentId} and event_type='JOIN_PAGE_VIEW') join_views,
      (select count(*)::int from product_events where establishment_id=${session.establishmentId} and event_type='JOIN_SUBMIT') join_submits,
      (select count(*)::int from product_events where establishment_id=${session.establishmentId} and event_type='SCAN_SUCCESS') scan_success,
      (select count(*)::int from product_events where establishment_id=${session.establishmentId} and event_type='SCAN_FAILED') scan_failed,
      (select coalesce(percentile_cont(0.5) within group (order by duration_ms),0)::int from product_events where establishment_id=${session.establishmentId} and event_type='SCAN_SUCCESS') scan_p50,
      (select coalesce(percentile_cont(0.95) within group (order by duration_ms),0)::int from product_events where establishment_id=${session.establishmentId} and event_type='SCAN_SUCCESS') scan_p95,
      (select count(distinct card_id)::int from transactions where establishment_id=${session.establishmentId} and type='earn') cards_with_activity,
      (select count(*)::int from (
        select card_id from transactions
        where establishment_id=${session.establishmentId} and type='earn'
        group by card_id
        having count(distinct date_trunc('day', created_at at time zone 'Europe/Paris')) >= 2
      ) recurring) cards_recurring
  `;
  const latest = await sql`
    select t.id,t.type,t.delta,t.balance_after,t.unit,t.created_at,c.short_code,u.first_name
    from transactions t join cards c on c.id=t.card_id join customers u on u.id=c.customer_id
    where t.establishment_id=${session.establishmentId} order by t.created_at desc limit 8
  `;
  const joinConversion = Number(stats.join_views) > 0 ? Math.round((Number(stats.join_submits) / Number(stats.join_views)) * 100) : 0;
  const scans = Number(stats.scan_success) + Number(stats.scan_failed);
  const scanErrorRate = scans > 0 ? Math.round((Number(stats.scan_failed) / scans) * 100) : 0;
  const recurringRate = Number(stats.cards_with_activity) > 0 ? Math.round((Number(stats.cards_recurring) / Number(stats.cards_with_activity)) * 100) : 0;

  const commerceDone = Boolean(restaurant.logo_url);
  const testDone = Number(stats.transactions) > 0;
  const checklist: { label: string; done: boolean; href: string }[] = [
    { label: "Compte créé", done: true, href: "/dashboard" },
    { label: "Commerce configuré", done: commerceDone, href: "/dashboard/settings" },
    { label: "Programme fidélité configuré", done: true, href: "/dashboard/program" },
    { label: "Imprimer le QR", done: false, href: "/dashboard/poster" },
    { label: "Installer Retiko sur le téléphone caisse", done: false, href: "/s" },
    { label: "Faire un premier test", done: testDone, href: "/s" },
  ];
  const nextStep = !commerceDone
    ? { text: "Étape suivante : personnalise ton commerce (logo et couleur).", href: "/dashboard/settings", cta: "Configurer mon commerce" }
    : !testDone
      ? { text: "Étape suivante : imprime ton QR client et fais un premier test.", href: "/dashboard/poster", cta: "Imprimer mon QR" }
      : { text: "Ton programme est prêt. Retiko peut accueillir de vrais clients.", href: "/s", cta: "Ouvrir le scanner" };

  return <><AppNav restaurantName={restaurant.name}/><main className="shell page">
    <div className="section-head"><div><span className="eyebrow">{program.mode === "STAMPS" ? "Tampons" : "Points"}</span><h2 style={{margin:"12px 0 4px"}}>{program.program_name}</h2><p className="muted">{program.reward_threshold} unités = {program.reward_label}</p></div><Link className="btn btn-primary" href="/s">Ouvrir le scanner</Link></div>
    <PwaInstallHint/>
    <section className="card" style={{marginTop:18, borderColor:"var(--accent)"}}>
      <div className="section-head"><div><span className="eyebrow">Étape suivante</span><p style={{margin:"10px 0 0", fontSize:17, fontWeight:700}}>{nextStep.text}</p></div><Link className="btn btn-primary" href={nextStep.href}>{nextStep.cta}</Link></div>
      <div className="grid grid-3" style={{marginTop:6}}>
        {checklist.map((item) => <Link key={item.label} href={item.href} style={{color: item.done ? "var(--success)" : "var(--text)"}}>{item.done ? "✓" : "○"} {item.label}</Link>)}
      </div>
      {!testDone && <div className="notice" style={{marginTop:16}}>
        <strong style={{display:"block", marginBottom:8}}>Comment faire mon premier test ?</strong>
        <ol style={{margin:0, paddingLeft:20, lineHeight:1.7}}>
          <li>Ouvre ton QR d’inscription (onglet séparé ou téléphone perso).</li>
          <li>Crée une carte de test avec ton propre email.</li>
          <li>Présente cette carte au scanner Retiko.</li>
          <li>Crédite un passage et vérifie que le solde bouge.</li>
        </ol>
        <p className="muted" style={{marginTop:8, marginBottom:0}}>Aucune donnée n’est créée automatiquement : le test utilise le vrai parcours client.</p>
      </div>}
    </section>
    <section className="grid grid-4" style={{marginTop:18}}>
      <div className="card metric"><strong>{stats.customers}</strong><span>clients inscrits</span></div>
      <div className="card metric"><strong>{stats.active_cards}</strong><span>cartes actives</span></div>
      <div className="card metric"><strong>{stats.units_issued}</strong><span>unités distribuées</span></div>
      <div className="card metric"><strong>{stats.rewards_redeemed}</strong><span>récompenses utilisées</span></div>
    </section>
    <section className="grid grid-4" style={{marginTop:18}}>
      <div className="card metric"><strong>{joinConversion} %</strong><span>conversion inscription</span></div>
      <div className="card metric"><strong>{stats.scan_success}</strong><span>scans réussis</span></div>
      <div className="card metric"><strong>{scanErrorRate} %</strong><span>taux d’erreur scanner</span></div>
      <div className="card metric"><strong>{stats.scan_failed}</strong><span>scans échoués</span></div>
    </section>
    <section className="grid grid-3" style={{marginTop:18}}>
      <div className="card metric"><strong>{stats.scan_p50} ms</strong><span>p50 QR → fiche client</span></div>
      <div className="card metric"><strong>{stats.scan_p95} ms</strong><span>p95 QR → fiche client</span></div>
      <div className="card metric"><strong>{recurringRate} %</strong><span>clients revenus sur ≥2 jours</span></div>
    </section>
    <section className="card" style={{marginTop:18}}><div className="section-head"><div><h3>Dernières transactions</h3><p className="muted">{stats.active_week} clients actifs sur 7 jours</p></div><Link className="btn" href="/dashboard/transactions">Tout voir</Link></div>{latest.length === 0 ? <div className="empty-state"><strong>Aucun passage enregistré.</strong><p>Fais ton premier test ou attends ton premier vrai client.</p><Link className="btn btn-primary" href="/s">Ouvrir le scanner</Link></div> : <div className="table-wrap"><table><thead><tr><th>Client</th><th>Action</th><th>Variation</th><th>Solde</th><th>Date</th></tr></thead><tbody>{latest.map((row)=><tr key={String(row.id)}><td>{row.first_name || row.short_code}</td><td>{row.type}</td><td>{Number(row.delta)>0?"+":""}{row.delta}</td><td>{row.balance_after}</td><td>{new Date(row.created_at).toLocaleString("fr-FR")}</td></tr>)}</tbody></table></div>}</section>
    <section className="grid grid-2" style={{marginTop:18}}><div className="card"><h3>QR d’inscription</h3><p className="muted">Lien public du commerce : <code>/j/{restaurant.slug}</code></p><Link className="btn" href="/dashboard/poster">Créer l’affiche A4</Link></div><div className="card"><h3>Wallet</h3><p className="muted">Apple Wallet et Google Wallet sont implémentés. Vérifie ici les credentials, passes émises et erreurs de synchronisation.</p><Link className="btn" href="/dashboard/wallet">Diagnostic Wallet</Link></div></section>
  </main></>;
}
