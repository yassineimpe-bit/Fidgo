import Link from "next/link";
import { ResendVerificationForm } from "@/components/resend-verification-form";

export default function ResendVerificationPage() {
  return <main className="auth-wrap"><section className="card auth-card">
    <span className="eyebrow">Espace commerçant</span>
    <h2 style={{marginTop:16}}>Renvoyer le lien de vérification</h2>
    <p className="muted" style={{marginBottom:18}}>Indique ton e-mail de connexion. La réponse reste volontairement identique qu’un compte corresponde ou non.</p>
    <ResendVerificationForm/>
    <p className="muted" style={{marginTop:18}}><Link href="/login"><strong>Retour à la connexion</strong></Link></p>
  </section></main>;
}
