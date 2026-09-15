import Link from "next/link";
import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { getWalletRuntimeStatus, type WalletProviderStatus } from "@/lib/wallet-status";

export const dynamic = "force-dynamic";

function StatusPill({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return <span className={`badge ${ok ? "success" : "warning"}`}>{children}</span>;
}

function providerDetail(status: WalletProviderStatus, readyText: string) {
  const parts: string[] = [];
  if (status.missing.length) parts.push(`Manque : ${status.missing.join(", ")}`);
  if (status.invalid.length) parts.push(`Invalide : ${status.invalid.join(", ")}`);
  return parts.length ? parts.join(" · ") : readyText;
}

export default async function WalletDashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [restaurant] = await sql`select name,slug from establishments where id=${session.establishmentId} limit 1`;
  const status = getWalletRuntimeStatus();
  const counts = await sql`
    select provider,status,count(*)::int as total
    from wallet_passes
    where establishment_id=${session.establishmentId}
    group by provider,status
    order by provider,status
  `;
  const errors = await sql`
    select provider,last_error,updated_at
    from wallet_passes
    where establishment_id=${session.establishmentId} and last_error is not null
    order by updated_at desc
    limit 10
  `;

  const countFor = (provider: string, state?: string) => counts
    .filter((row) => String(row.provider) === provider && (!state || String(row.status) === state))
    .reduce((sum, row) => sum + Number(row.total), 0);

  return <><AppNav restaurantName={restaurant?.name}/><main className="shell page">
    <div className="section-head"><div><span className="eyebrow">Wallet</span><h2 style={{margin:"12px 0 4px"}}>État Apple Wallet / Google Wallet</h2><p className="muted">Diagnostic de configuration sans exposer les certificats, clés privées ou JSON de service account.</p></div><Link className="btn" href={`/j/${restaurant?.slug}`}>Ouvrir l’inscription</Link></div>

    <section className="grid grid-3">
      <div className="card"><h3>HTTPS</h3><StatusPill ok={status.appUrlConfigured && status.appUrlHttps}>{status.appUrlConfigured && status.appUrlHttps ? "Prêt" : "À configurer"}</StatusPill><p className="muted" style={{marginTop:10}}>Fidgo utilise NEXT_PUBLIC_APP_URL lorsqu’il est défini, sinon l’URL HTTPS système fournie par Vercel.</p></div>
      <div className="card"><h3>Google Wallet</h3><StatusPill ok={status.google.configured}>{status.google.configured ? "Prêt" : status.google.enabled ? "Incomplet" : "Désactivé"}</StatusPill><p className="muted" style={{marginTop:10}}>{providerDetail(status.google,"Issuer et service account présents et parsables.")}</p><p><strong>{countFor("GOOGLE","active")}</strong> pass actif(s)</p></div>
      <div className="card"><h3>Apple Wallet</h3><StatusPill ok={status.apple.configured}>{status.apple.configured ? "Prêt" : status.apple.enabled ? "Incomplet" : "Désactivé"}</StatusPill><p className="muted" style={{marginTop:10}}>{providerDetail(status.apple,"Pass Type ID, certificats et clé présents et parsables.")}</p><p><strong>{countFor("APPLE","active")}</strong> pass actif(s)</p></div>
    </section>

    <section className="card" style={{marginTop:18}}><h3>Chemin vers le premier pass réel</h3><ol style={{lineHeight:1.8,paddingLeft:22}}><li>Base PostgreSQL, AUTH_SECRET et HTTPS opérationnels.</li><li>Créer une carte client depuis le QR d’inscription.</li><li>Configurer Google Wallet ou Apple Wallet dans les variables d’environnement.</li><li>Vérifier ici que le provider affiche réellement <strong>Prêt</strong>.</li><li>Ouvrir la carte client et toucher le bouton Wallet correspondant.</li><li>Créditer la carte au scanner et vérifier que le solde du Wallet se met à jour.</li></ol></section>

    <section className="card" style={{marginTop:18}}><div className="section-head"><div><h3>Erreurs Wallet récentes</h3><p className="muted">Les erreurs techniques sont enregistrées sans afficher les credentials.</p></div><span className="badge">{errors.length}</span></div>{errors.length ? <div className="table-wrap"><table><thead><tr><th>Provider</th><th>Erreur</th><th>Date</th></tr></thead><tbody>{errors.map((row,index)=><tr key={`${row.provider}-${index}`}><td>{String(row.provider)}</td><td><code>{String(row.last_error).slice(0,500)}</code></td><td>{new Date(row.updated_at).toLocaleString("fr-FR")}</td></tr>)}</tbody></table></div> : <p className="muted">Aucune erreur Wallet enregistrée.</p>}</section>
  </main></>;
}
