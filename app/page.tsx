import Link from "next/link";
export default function Home() {
  return (
    <main>
      <section className="hero">
        <div className="shell hero-grid">
          <div>
            <span className="eyebrow">Fidélité digitale, sans appli client</span>
            <h1>Le QR fidélité pensé pour le rush.</h1>
            <p className="lead">Tampons ou points, carte web mobile, scanner commerçant et base Wallet prête. Le cœur du produit est volontairement simple : présenter, scanner, créditer, terminé.</p>
            <div className="actions">
              <Link className="btn btn-primary" href="/signup">Créer un restaurant</Link>
              <Link className="btn" href="/login">Connexion</Link>
            </div>
          </div>
          <div className="card">
            <span className="eyebrow">Objectif terrain</span>
            <h2 style={{marginTop:16}}>Moins de 3 secondes</h2>
            <p className="muted">Caméra déjà ouverte, fiche client immédiate, un bouton principal. Pas de tunnel administratif pendant qu’une file de douze personnes juge silencieusement le serveur.</p>
            <div className="grid grid-3" style={{marginTop:24}}>
              <div className="metric"><strong>1</strong><span>scan</span></div>
              <div className="metric"><strong>1</strong><span>action</span></div>
              <div className="metric"><strong>&lt;3s</strong><span>cible</span></div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
