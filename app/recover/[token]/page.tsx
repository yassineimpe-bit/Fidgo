import type { Metadata } from "next";
import Link from "next/link";
import { RecoveryClient } from "@/components/recovery-client";
import { isValidCardRecoveryToken } from "@/lib/card-recovery";

export const metadata: Metadata = {
  title: "Retrouver ma carte | Retiko",
  robots: { index: false, follow: false, noarchive: true },
  referrer: "no-referrer",
};

export default async function RecoveryPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const validShape = isValidCardRecoveryToken(token);

  return <main className="auth-wrap">
    <section className="card auth-card">
      <span className="eyebrow">Retiko</span>
      <h2 style={{margin:"14px 0 8px"}}>Retrouver ma carte fidélité</h2>
      {validShape ? <>
        <p className="muted">
          Ce lien prouve l’accès à l’adresse email utilisée pour la carte. Aucun solde ne sera modifié.
        </p>
        <RecoveryClient token={token}/>
      </> : <>
        <div className="notice error">Ce lien de récupération est invalide.</div>
        <p className="muted">Retourne sur la page d’inscription du commerce et demande un nouveau lien.</p>
      </>}
      <div style={{marginTop:18}}><Link className="btn" href="/">Retour à Retiko</Link></div>
    </section>
  </main>;
}
