import type { Metadata } from "next";
import Link from "next/link";
import { BILLING_PLANS } from "@/lib/billing";

export const metadata: Metadata = {
  title: "Carte de fidélité digitale pour restaurants",
  description: "Retiko transforme un QR code en carte de fidélité digitale : tampons ou points, scanner commerçant, Apple Wallet, Google Wallet et carte web mobile.",
  keywords: ["carte fidélité digitale", "QR fidélité restaurant", "Apple Wallet fidélité", "Google Wallet fidélité", "programme fidélité restaurant"],
  alternates: { canonical: "/" },
  openGraph: {
    title: "Retiko · Fidélité digitale pensée pour le rush",
    description: "QR client, scanner commerçant, tampons ou points et Wallet. Sans application à installer côté client.",
    type: "website",
    locale: "fr_FR",
  },
};

const steps = [
  ["1", "Le client scanne ton QR", "Il crée sa carte en quelques secondes depuis Safari ou Chrome, sans télécharger d’application."],
  ["2", "Tu scans sa carte", "Le téléphone caisse ouvre la fiche client et affiche le solde immédiatement."],
  ["3", "Tu crédites", "Un bouton ajoute un tampon ou les points prévus par ton programme. Retiko gère le double scan et la concurrence."],
  ["4", "La carte se met à jour", "Le client retrouve son solde sur le web, Apple Wallet ou Google Wallet selon son appareil."],
] as const;

const features = [
  ["QR d’inscription", "Un QR par commerce pour créer la carte client. Aucun email ou numéro de téléphone n’est encodé dans le QR."],
  ["Tampons ou points", "Choisis un système simple à tampons ou une règle de points par achat ou selon le montant dépensé."],
  ["Apple & Google Wallet", "Le client peut garder sa carte dans son portefeuille numérique, avec QR et solde mis à jour."],
  ["Scanner commerçant", "Pensé pour la caisse : caméra ouverte, fiche client rapide, une action principale et protections anti-double crédit."],
] as const;

export default function Home() {
  return (
    <main>
      <header className="topbar no-print">
        <div className="shell topbar-inner">
          <Link className="brand" href="/">Retiko</Link>
          <nav className="navlinks">
            <a href="#demo">Comment ça marche</a>
            <a href="#features">Fonctions</a>
            <a href="#pricing">Prix</a>
            <Link className="btn" href="/login">Connexion</Link>
            <Link className="btn btn-primary" href="/signup">Démarrer l’essai</Link>
          </nav>
        </div>
      </header>

      <section className="hero">
        <div className="shell hero-grid">
          <div>
            <span className="eyebrow">Fidélité digitale, sans appli client</span>
            <h1>Le QR fidélité pensé pour le rush.</h1>
            <p className="lead">Tampons ou points, carte web mobile, scanner commerçant et Wallet. Le client scanne, tu crédites, sa carte se met à jour. Pas de tunnel administratif pendant le service.</p>
            <div className="actions">
              <Link className="btn btn-primary" href="/signup">Démarrer l’essai</Link>
              <a className="btn" href="#demo">Voir le parcours</a>
            </div>
            <p className="muted" style={{marginTop:14}}>30 jours d’essai sur le pilote. Aucune application à installer côté client.</p>
          </div>
          <div className="card">
            <span className="eyebrow">Objectif terrain</span>
            <h2 style={{marginTop:16}}>Moins de 3 secondes</h2>
            <p className="muted">Caméra déjà ouverte, fiche client immédiate, un bouton principal. Le produit doit survivre à une vraie file d’attente, pas seulement à une jolie démo.</p>
            <div className="grid grid-3" style={{marginTop:24}}>
              <div className="metric"><strong>1</strong><span>scan</span></div>
              <div className="metric"><strong>1</strong><span>action</span></div>
              <div className="metric"><strong>&lt;3s</strong><span>cible pilote</span></div>
            </div>
          </div>
        </div>
      </section>

      <section id="demo" className="shell page" aria-labelledby="demo-title">
        <div className="section-head">
          <div><span className="eyebrow">Démonstration</span><h2 id="demo-title" style={{marginTop:14}}>Du QR à la récompense en quatre étapes.</h2></div>
        </div>
        <div className="grid grid-4">
          {steps.map(([number,title,body]) => <article className="card" key={number}>
            <span className="eyebrow">{number}</span>
            <h3 style={{marginTop:16}}>{title}</h3>
            <p className="muted">{body}</p>
          </article>)}
        </div>
      </section>

      <section id="features" className="shell page" aria-labelledby="features-title">
        <div className="section-head">
          <div><span className="eyebrow">Produit</span><h2 id="features-title" style={{marginTop:14}}>Une carte fidèle au commerce, pas une usine à gaz.</h2></div>
        </div>
        <div className="grid grid-2">
          {features.map(([title,body]) => <article className="card" key={title}><h3>{title}</h3><p className="muted">{body}</p></article>)}
        </div>
      </section>

      <section className="shell page" aria-labelledby="wallet-title">
        <div className="grid grid-2">
          <article className="card">
            <span className="eyebrow">Wallet</span>
            <h2 id="wallet-title" style={{marginTop:14}}>Apple Wallet et Google Wallet.</h2>
            <p className="lead" style={{fontSize:17}}>Le QR client, le solde et la récompense suivent la carte. La version web mobile reste disponible même sans Wallet.</p>
          </article>
          <article className="card">
            <span className="eyebrow">Fidélité</span>
            <h2 style={{marginTop:14}}>Tampons ou points.</h2>
            <p className="lead" style={{fontSize:17}}>Configure le seuil, la récompense et la règle de gain. Le ledger conserve chaque mouvement et les corrections passent par des opérations compensatrices.</p>
          </article>
        </div>
      </section>

      <section id="pricing" className="shell page" aria-labelledby="pricing-title">
        <div className="section-head">
          <div><span className="eyebrow">Tarifs pilote</span><h2 id="pricing-title" style={{marginTop:14}}>Un prix simple à expliquer au comptoir.</h2><p className="muted">Les montants affichés reprennent les plans actuellement configurés dans Retiko.</p></div>
        </div>
        <div className="grid grid-3">
          <article className="card"><h3>{BILLING_PLANS.RETIKO_12.label}</h3><p className="metric"><strong>{BILLING_PLANS.RETIKO_12.priceLabel}</strong></p><p className="muted">{BILLING_PLANS.RETIKO_12.commitment}</p><Link className="btn btn-primary" href="/signup">Démarrer l’essai</Link></article>
          <article className="card"><h3>{BILLING_PLANS.ANNUAL.label}</h3><p className="metric"><strong>{BILLING_PLANS.ANNUAL.priceLabel}</strong></p><p className="muted">{BILLING_PLANS.ANNUAL.commitment}</p><Link className="btn btn-primary" href="/signup">Démarrer l’essai</Link></article>
          <article className="card"><h3>{BILLING_PLANS.FLEX.label}</h3><p className="metric"><strong>{BILLING_PLANS.FLEX.priceLabel}</strong></p><p className="muted">{BILLING_PLANS.FLEX.commitment}</p><Link className="btn" href="/signup">Créer mon espace</Link></article>
        </div>
      </section>

      <section className="shell page">
        <div className="card" style={{textAlign:"center"}}>
          <span className="eyebrow">Pilote</span>
          <h2 style={{margin:"16px auto 10px"}}>Teste le parcours avant de le mettre devant tes clients.</h2>
          <p className="lead" style={{margin:"0 auto 22px"}}>Crée ton commerce, configure ton programme, imprime ton QR et fais un premier passage avec ton téléphone.</p>
          <Link className="btn btn-primary" href="/signup">Démarrer l’essai</Link>
        </div>
      </section>
    </main>
  );
}
