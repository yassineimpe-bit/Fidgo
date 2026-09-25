import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import QRCode from "qrcode";
import { BrandPreview } from "@/components/brand-preview";
import { LegalLinks } from "@/components/legal-links";
import { getAppUrl } from "@/lib/app-url";
import { BILLING_PLANS, BILLING_TRIAL_DAYS } from "@/lib/billing-plans";

const TITLE = "Retiko — carte de fidélité QR pour restaurants et commerces";
const DESCRIPTION = "Carte de fidélité digitale à tampons ou à points : inscription client par QR sans application, scanner commerçant pensé pour le rush, compatible Apple Wallet et Google Wallet. Essai gratuit 30 jours.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: { type: "website", locale: "fr_FR", siteName: "Retiko", title: TITLE, description: DESCRIPTION, url: "/" },
  twitter: { card: "summary", title: TITLE, description: DESCRIPTION },
  robots: { index: true, follow: true },
};

const STEPS = [
  { title: "Affichez le QR", text: "Imprimez l’affiche générée à vos couleurs et posez-la près de la caisse." },
  { title: "Le client s’inscrit", text: "Il scanne, saisit son prénom et son e-mail : sa carte s’ouvre dans le navigateur, sans application à installer." },
  { title: "Vous scannez en caisse", text: "Le scanner reconnaît la carte, un seul bouton crédite le tampon ou les points. Le double crédit est bloqué." },
  { title: "La récompense tombe", text: "Au seuil choisi, la récompense s’affiche des deux côtés ; vous la validez, le compteur repart." },
];

const PLAN_ORDER = ["FLEX", "RETIKO_12", "ANNUAL"] as const;

export default async function Home() {
  const appUrl = getAppUrl() || "https://retiko.fr";
  const signupQr = await QRCode.toDataURL(`${appUrl}/signup`, { width: 240, margin: 1, errorCorrectionLevel: "M" });
  const nonce = (await headers()).get("x-nonce") || undefined;
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Retiko",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description: DESCRIPTION,
    url: appUrl,
    offers: PLAN_ORDER.map((plan) => ({
      "@type": "Offer",
      name: BILLING_PLANS[plan].label,
      description: `${BILLING_PLANS[plan].priceLabel} — ${BILLING_PLANS[plan].commitment}`,
      priceCurrency: "EUR",
    })),
  };

  return (
    <main className="landing">
      <script type="application/ld+json" nonce={nonce} dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} />
      <section className="hero">
        <div className="shell hero-grid">
          <div>
            <span className="eyebrow">Fidélité digitale, sans appli client</span>
            <h1>Le QR fidélité pensé pour le rush.</h1>
            <p className="lead">Tampons ou points, carte web mobile, scanner commerçant et base Wallet prête. Le cœur du produit est volontairement simple : présenter, scanner, créditer, terminé.</p>
            <div className="actions">
              <Link className="btn btn-accent" href="/signup">Essayer gratuitement {BILLING_TRIAL_DAYS} jours</Link>
              <Link className="btn" href="/login">Connexion</Link>
            </div>
          </div>
          <div className="card hero-showcase">
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

      <section className="landing-section" id="demo" aria-labelledby="demo-title">
        <div className="shell">
          <span className="eyebrow">Démonstration du parcours</span>
          <h2 id="demo-title">De l’affiche à la récompense, en quatre gestes</h2>
          <ol className="landing-steps">
            {STEPS.map((step, index) => <li key={step.title}><span className="landing-step-number">{index + 1}</span><h3>{step.title}</h3><p className="muted">{step.text}</p></li>)}
          </ol>
        </div>
      </section>

      <section className="landing-section landing-alt" id="fidelite" aria-labelledby="fidelite-title">
        <div className="shell landing-split">
          <div>
            <span className="eyebrow">Programme de fidélité</span>
            <h2 id="fidelite-title">Tampons ou points, à votre image</h2>
            <ul className="landing-list">
              <li><strong>Tampons par passage</strong> ou <strong>points</strong> par achat ou par euro dépensé.</li>
              <li>Seuil, récompense, nom de l’unité (« café », « baguette »), couleur et logo réglés en quelques minutes.</li>
              <li>Protection contre le double crédit : double clic, double lecture caméra, délai entre deux crédits.</li>
              <li>Historique de chaque carte, statistiques de fréquentation et clients à relancer dans le tableau de bord.</li>
              <li>Rôles propriétaire, manager et employé, chaque action sensible tracée.</li>
            </ul>
          </div>
          <div aria-label="Exemple de carte fidélité">
            <BrandPreview name="Boulangerie du centre" logoUrl="" primaryColor="#7a3e2d" rewardThreshold={10} rewardLabel="Une baguette offerte" unit="baguettes" qr={signupQr} />
          </div>
        </div>
      </section>

      <section className="landing-section" id="qr" aria-labelledby="qr-title">
        <div className="shell landing-split">
          <div>
            <span className="eyebrow">QR code</span>
            <h2 id="qr-title">Un QR pour s’inscrire, un QR par client</h2>
            <p className="muted">L’affiche de votre commerce ouvre l’inscription. Chaque client reçoit ensuite un QR personnel, opaque et unique : il ne contient ni nom ni e-mail, et le scanner l’accepte uniquement pour votre commerce.</p>
            <p className="muted">Pas de caméra disponible ? Le code court de la carte, l’e-mail ou le téléphone du client suffisent au comptoir.</p>
          </div>
          <div className="card landing-qr">
            {/* eslint-disable-next-line @next/next/no-img-element -- data URL générée côté serveur. */}
            <img src={signupQr} alt="QR code d’essai Retiko" width={180} height={180} />
            <p className="muted">Scannez pour ouvrir l’essai sur votre téléphone.</p>
          </div>
        </div>
      </section>

      <section className="landing-section landing-alt" id="wallet" aria-labelledby="wallet-title">
        <div className="shell">
          <span className="eyebrow">Apple Wallet et Google Wallet</span>
          <h2 id="wallet-title">La carte dans le téléphone, pas dans le portefeuille</h2>
          <p className="muted landing-narrow">La carte web fonctionne sur tous les téléphones. Elle peut aussi être ajoutée à Apple Wallet ou à Google Wallet : le solde s’y met à jour après chaque passage et le même QR sert en caisse. L’ajout aux Wallets est activé progressivement pendant la phase pilote.</p>
        </div>
      </section>

      <section className="landing-section" id="prix" aria-labelledby="prix-title">
        <div className="shell">
          <span className="eyebrow">Prix</span>
          <h2 id="prix-title">Un abonnement, tout compris</h2>
          <p className="muted">{BILLING_TRIAL_DAYS} jours d’essai gratuit, sans carte bancaire pour commencer. Clients, scans et cartes illimités.</p>
          <div className="landing-plans">
            {PLAN_ORDER.map((plan) => {
              const definition = BILLING_PLANS[plan];
              return <article key={plan} className={`card landing-plan${plan === "RETIKO_12" ? " is-featured" : ""}`}>
                <h3>{definition.label}</h3>
                <p className="landing-price">{definition.priceLabel}</p>
                <p className="muted">{definition.commitment}</p>
                <Link className={`btn ${plan === "RETIKO_12" ? "btn-accent" : ""}`} href="/signup">Commencer l’essai</Link>
              </article>;
            })}
          </div>
          <p className="muted" style={{fontSize:13}}>Prix hors taxes. Conditions détaillées dans les <Link href="/legal/cgv">CGV</Link>.</p>
        </div>
      </section>

      <section className="landing-section landing-cta" aria-labelledby="cta-title">
        <div className="shell">
          <h2 id="cta-title">Prêt pour le prochain rush ?</h2>
          <p className="muted">Créez votre commerce, réglez votre programme et imprimez votre affiche en moins de dix minutes.</p>
          <Link className="btn btn-accent" href="/signup">Essayer gratuitement {BILLING_TRIAL_DAYS} jours</Link>
        </div>
      </section>
      <footer className="site-footer"><LegalLinks /></footer>
    </main>
  );
}
